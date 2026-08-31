import { ChronoError } from "./errors.ts";
import { sha256Utf8 } from "./sha.ts";
import {
  PROVIDER_VERSION,
  RECEIPT_SCHEMA_ID,
  type RunObservation,
  type RunReceipt,
  type RunRequest,
  type WorkerIdentity,
} from "./types.ts";

type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};

/** Stable JSON serialization for identities, never for caller-visible case bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ChronoError(
        "receipt_invalid",
        "Receipt content must contain finite numbers.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, JsonValue>;
    return `{${
      Object.keys(object).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(object[key])}`
      ).join(",")
    }}`;
  }
  throw new ChronoError("receipt_invalid", "Receipt content must be JSON data.");
}

export async function sha256CanonicalJson(value: unknown): Promise<string> {
  return await sha256Utf8(canonicalJson(value));
}

type ReceiptPreimage = Omit<RunReceipt, "receipt_sha256">;

function identityFromReceipt(receipt: RunReceipt): Pick<
  RunReceipt,
  "package" | "provider" | "server_runtime"
> {
  return {
    package: receipt.package,
    provider: receipt.provider,
    server_runtime: receipt.server_runtime,
  };
}

function preimage(
  caseSha256: string,
  request: RunRequest,
  recordedAt: string,
  output: RunObservation,
  worker: WorkerIdentity,
  outcomeSha256: string,
  identity: Pick<RunReceipt, "package" | "provider" | "server_runtime">,
): ReceiptPreimage {
  return {
    schema_id: RECEIPT_SCHEMA_ID,
    case_sha256: caseSha256,
    outcome_sha256: outcomeSha256,
    request_id: request.request_id,
    recorded_at: recordedAt,
    package: identity.package,
    provider: identity.provider,
    worker,
    runtime: output.runtime,
    server_runtime: identity.server_runtime,
    execution_state: output.execution_state,
    kinematics_exit: output.kinematics_exit,
  };
}

export async function createRunReceipt(
  caseSha256: string,
  request: RunRequest,
  recordedAt: string,
  output: RunObservation,
  worker: WorkerIdentity,
): Promise<RunReceipt> {
  const outcome_sha256 = await sha256CanonicalJson(output);
  const content = preimage(
    caseSha256,
    request,
    recordedAt,
    output,
    worker,
    outcome_sha256,
    {
      package: { name: "@casys/mcp-chrono", version: PROVIDER_VERSION },
      provider: { name: "casys-chrono", version: PROVIDER_VERSION },
      server_runtime: { deno_version: Deno.version.deno },
    },
  );
  return { ...content, receipt_sha256: await sha256CanonicalJson(content) };
}

export async function verifyRunReceipt(
  receipt: RunReceipt,
  caseSha256: string,
  request: RunRequest,
  recordedAt: string,
  output: RunObservation,
): Promise<void> {
  const outcomeSha256 = await sha256CanonicalJson(output);
  if (receipt.outcome_sha256 !== outcomeSha256 || receipt.case_sha256 !== caseSha256) {
    throw new ChronoError(
      "persisted_ledger_invalid",
      "Receipt content identity is invalid.",
    );
  }
  const content = preimage(
    caseSha256,
    request,
    recordedAt,
    output,
    receipt.worker,
    outcomeSha256,
    identityFromReceipt(receipt),
  );
  if (receipt.receipt_sha256 !== await sha256CanonicalJson(content)) {
    throw new ChronoError("persisted_ledger_invalid", "Receipt SHA-256 is invalid.");
  }
}
