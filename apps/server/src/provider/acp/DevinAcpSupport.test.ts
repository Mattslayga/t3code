import { describe, expect, it } from "@effect/vitest";

import {
  buildDevinAcpSpawnInput,
  devinModeIdForInteractionMode,
  devinModeIdForRuntimeMode,
  resolveDevinAcpModelId,
} from "./DevinAcpSupport.ts";

describe("resolveDevinAcpModelId", () => {
  it("treats empty input and the product sentinel as keep-current", () => {
    expect(resolveDevinAcpModelId(undefined)).toBeUndefined();
    expect(resolveDevinAcpModelId(null)).toBeUndefined();
    expect(resolveDevinAcpModelId("   ")).toBeUndefined();
    expect(resolveDevinAcpModelId("devin-default")).toBeUndefined();
  });

  it("passes through real Devin model uids", () => {
    expect(resolveDevinAcpModelId("swe-2-max")).toBe("swe-2-max");
    expect(resolveDevinAcpModelId(" claude-opus-5-high ")).toBe("claude-opus-5-high");
  });

  it("expands Devin aliases", () => {
    expect(resolveDevinAcpModelId("opus")).toBe("claude-opus-5-medium");
    expect(resolveDevinAcpModelId("sonnet")).toBe("claude-sonnet-5-medium");
    expect(resolveDevinAcpModelId("swe")).toBe("swe-2-max");
  });
});

describe("devinModeIdForRuntimeMode", () => {
  it("maps T3 runtime modes onto Devin session modes", () => {
    expect(devinModeIdForRuntimeMode("approval-required")).toBe("ask");
    expect(devinModeIdForRuntimeMode("auto-accept-edits")).toBe("accept-edits");
    expect(devinModeIdForRuntimeMode("auto")).toBe("smart");
    expect(devinModeIdForRuntimeMode("full-access")).toBe("bypass");
  });
});

describe("devinModeIdForInteractionMode", () => {
  it("maps only plan interaction mode", () => {
    expect(devinModeIdForInteractionMode("plan")).toBe("plan");
    expect(devinModeIdForInteractionMode("default")).toBeUndefined();
    expect(devinModeIdForInteractionMode(undefined)).toBeUndefined();
  });
});

describe("buildDevinAcpSpawnInput", () => {
  it("spawns `devin acp` from the configured binary path", () => {
    expect(buildDevinAcpSpawnInput({ binaryPath: "/usr/local/bin/devin" }, "/repo")).toEqual({
      command: "/usr/local/bin/devin",
      args: ["acp"],
      cwd: "/repo",
    });
  });

  it("falls back to `devin` on PATH when binaryPath is empty", () => {
    expect(buildDevinAcpSpawnInput(undefined, "/repo").command).toBe("devin");
    expect(buildDevinAcpSpawnInput({ binaryPath: "" }, "/repo").command).toBe("devin");
  });
});
