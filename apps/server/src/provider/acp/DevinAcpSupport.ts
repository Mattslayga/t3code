/**
 * DevinAcpSupport — shared ACP helpers for the Devin (`devin`) runtime.
 *
 * `devin acp` speaks standard ACP over stdio. Unlike the other ACP agents it
 * authenticates out-of-band: stored credentials from `devin auth login` are
 * picked up automatically, while its only advertised auth method
 * (`devin-browser`) tries to open a browser — so no `authMethodId` is sent.
 *
 * Runtime modes and models are both session config options (`mode`, `model`);
 * `devin acp` rejects process-level permission flags.
 *
 * @module provider/acp/DevinAcpSupport
 */
import {
  DEVIN_DEFAULT_MODEL,
  type DevinSettings,
  type ProviderInteractionMode,
  ProviderDriverKind,
  type RuntimeMode,
} from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const DEVIN_DRIVER_KIND = ProviderDriverKind.make("devin");

export interface DevinAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly devinSettings: Pick<DevinSettings, "binaryPath"> | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildDevinAcpSpawnInput(
  devinSettings: Pick<DevinSettings, "binaryPath"> | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: devinSettings?.binaryPath || "devin",
    args: ["acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeDevinAcpRuntime = (
  input: DevinAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildDevinAcpSpawnInput(input.devinSettings, input.cwd, input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

/**
 * Resolves a T3 model slug to a Devin ACP `model` config-option value.
 * `devin-default` (and empty input) means keep the session's current model —
 * it is never a valid ACP value and must not be sent to `setModel`.
 */
export function resolveDevinAcpModelId(model: string | null | undefined): string | undefined {
  const normalized = normalizeModelSlug(model, DEVIN_DRIVER_KIND);
  if (!normalized || normalized === DEVIN_DEFAULT_MODEL) {
    return undefined;
  }
  return normalized;
}

/** T3 runtime mode → Devin ACP `mode` config-option value. */
export function devinModeIdForRuntimeMode(runtimeMode: RuntimeMode): string {
  switch (runtimeMode) {
    case "approval-required":
      return "ask";
    case "auto-accept-edits":
      return "accept-edits";
    case "auto":
      return "smart";
    case "full-access":
      return "bypass";
  }
}

/**
 * T3 interaction mode → Devin ACP `mode` value, when the interaction mode
 * needs a dedicated Devin mode. "default" defers to the runtime mode.
 */
export function devinModeIdForInteractionMode(
  interactionMode: ProviderInteractionMode | undefined,
): string | undefined {
  return interactionMode === "plan" ? "plan" : undefined;
}
