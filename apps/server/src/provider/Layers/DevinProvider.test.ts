// @effect-diagnostics nodeBuiltinImport:off - resolves the mock ACP agent script path relative to this test file.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { DevinSettings } from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  buildDevinModelsFromConfigOptions,
  checkDevinProviderStatus,
  parseDevinAuthStatus,
} from "./DevinProvider.ts";
import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const LOGGED_IN_AUTH_OUTPUT = [
  "Logged in (via Devin).",
  "",
  "User:",
  "  Name:              Test User",
  "  Email:             dev@example.com",
  "",
  "Account:",
  "  Tier:              Devin Pro",
  "",
].join("\n");

describe("parseDevinAuthStatus", () => {
  it("reads a logged-in status block with email and tier", () => {
    const auth = parseDevinAuthStatus({
      code: 0,
      stdout: [
        "Logged in (via Devin).",
        "",
        "User:",
        "  Name:              Matthew Slager",
        "  Email:             matt@example.com",
        "",
        "Account:",
        "  Tier:              Devin Pro",
      ].join("\n"),
      stderr: "",
    });
    expect(auth).toEqual({
      status: "authenticated",
      type: "cached_token",
      label: "Devin Pro account",
      email: "matt@example.com",
    });
  });

  it("reports unauthenticated on an explicit not-logged-in status", () => {
    expect(parseDevinAuthStatus({ code: 1, stdout: "", stderr: "Not logged in." })).toEqual({
      status: "unauthenticated",
    });
  });

  it("reports unknown when the output carries no verdict", () => {
    expect(parseDevinAuthStatus({ code: 0, stdout: "something else", stderr: "" })).toEqual({
      status: "unknown",
    });
  });
});

describe("buildDevinModelsFromConfigOptions", () => {
  const modelOption = {
    type: "select",
    id: "model",
    name: "Model",
    category: "model",
    currentValue: "swe-2-max",
    options: [
      { value: "swe-2-max", name: "SWE 2 Max" },
      { value: "claude-opus-5-medium", name: "Claude Opus 5 Medium" },
    ],
  } satisfies EffectAcpSchema.SessionConfigOption;

  it("prepends the devin-default sentinel and lists real model uids", () => {
    const models = buildDevinModelsFromConfigOptions([modelOption]);
    expect(models[0]).toMatchObject({ slug: "devin-default", isDefault: true });
    expect(models.map((model) => model.slug)).toEqual([
      "devin-default",
      "swe-2-max",
      "claude-opus-5-medium",
    ]);
  });

  it("flattens grouped select options", () => {
    const models = buildDevinModelsFromConfigOptions([
      {
        ...modelOption,
        options: [
          {
            group: "claude",
            name: "Claude",
            options: [{ value: "claude-sonnet-5-medium", name: "Claude Sonnet 5 Medium" }],
          },
        ],
      },
    ]);
    expect(models.map((model) => model.slug)).toEqual(["devin-default", "claude-sonnet-5-medium"]);
  });

  it("returns empty when no model select option is advertised", () => {
    expect(buildDevinModelsFromConfigOptions([])).toEqual([]);
    expect(buildDevinModelsFromConfigOptions(undefined)).toEqual([]);
    expect(
      buildDevinModelsFromConfigOptions([
        { type: "boolean", id: "fast", name: "Fast", currentValue: true },
      ]),
    ).toEqual([]);
  });
});

// A stand-in for the Devin CLI: `version` and `auth status` print canned text,
// and `acp` execs the mock ACP agent so `session/new` returns config options.
const writeFakeDevinCli = (input: { readonly loggedIn: boolean; readonly acp: boolean }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-devin-probe-" });
    const mockAgentPath = NodePath.resolve(__dirname, "../../../scripts/acp-mock-agent.ts");
    return writeFakeCli({
      directory: dir,
      name: "devin",
      source: [
        'if (process.argv[2] === "version") {',
        '  process.stdout.write("devin 3000.10.31 (abc123)\\n");',
        "  process.exit(0);",
        "}",
        'if (process.argv[2] === "auth" && process.argv[3] === "status") {',
        input.loggedIn
          ? // @effect-diagnostics-next-line preferSchemaOverJson:off
            `  process.stdout.write(${JSON.stringify(LOGGED_IN_AUTH_OUTPUT)});`
          : '  process.stderr.write("Not logged in.\\n"); process.exit(1);',
        "  process.exit(0);",
        "}",
        'if (process.argv[2] !== "acp") process.exit(1);',
        ...(input.acp ? [execScriptSource({ scriptPath: mockAgentPath })] : ["process.exit(3);"]),
        "",
      ].join("\n"),
    });
  });

it.layer(NodeServices.layer)("checkDevinProviderStatus", (it) => {
  it.effect("reports the binary as missing when the binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkDevinProviderStatus(
        decodeDevinSettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/devin-binary",
        }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH|Failed to execute/);
    }),
  );

  it.effect("reports ready with ACP-discovered models when logged in", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const devinPath = yield* writeFakeDevinCli({ loggedIn: true, acp: true });
          return yield* checkDevinProviderStatus(
            decodeDevinSettings({ enabled: true, binaryPath: devinPath }),
          );
        }),
      );

      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("3000.10.31");
      expect(snapshot.auth).toEqual({
        status: "authenticated",
        type: "cached_token",
        label: "Devin Pro account",
        email: "dev@example.com",
      });
      // devin-default sentinel first, then the mock agent's catalog.
      expect(snapshot.models[0]?.slug).toBe("devin-default");
      expect(snapshot.models[0]?.isDefault).toBe(true);
      expect(snapshot.models.map((model) => model.slug)).toContain("composer-2");
    }),
  );

  it.effect("reports unauthenticated without starting an ACP session", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const devinPath = yield* writeFakeDevinCli({ loggedIn: false, acp: false });
          return yield* checkDevinProviderStatus(
            decodeDevinSettings({ enabled: true, binaryPath: devinPath }),
          );
        }),
      );

      expect(snapshot.status).toBe("error");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.message).toContain("devin auth login");
      expect(snapshot.models.map((model) => model.slug)).toEqual(["devin-default"]);
    }),
  );

  it.effect("degrades to a warning when the ACP session probe fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const devinPath = yield* writeFakeDevinCli({ loggedIn: true, acp: false });
          return yield* checkDevinProviderStatus(
            decodeDevinSettings({ enabled: true, binaryPath: devinPath }),
          );
        }),
      );

      expect(snapshot.status).toBe("warning");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.message).toContain("ACP session probe failed");
      expect(snapshot.models.map((model) => model.slug)).toEqual(["devin-default"]);
    }),
  );
});
