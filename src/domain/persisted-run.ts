import { ChronoError } from "./errors.ts";
import { verifyRunReceipt } from "./receipt.ts";
import { requireSha256 } from "./sha.ts";
import type {
  PrescribedKinematicsCase,
  RunIntent,
  RunObservation,
  RunReceipt,
  RunRecord,
  RunRequest,
} from "./types.ts";
import { PROVIDER_VERSION, RECEIPT_SCHEMA_ID } from "./types.ts";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NOT_EVALUATED = [
  "collision",
  "clearance",
  "contact",
  "forces",
  "torques",
  "dynamics",
  "strength",
  "safety",
  "product fitness",
] as const;
const CASE_URI_PREFIX = "chrono-case:sha256:";
const EXIT_FLAG_NAMES: Readonly<Record<number, string>> = {
  0: "NOT_CONVERGED",
  1: "SUCCESS",
  2: "ABSTOL_RESIDUAL",
  3: "RELTOL_UPDATE",
  4: "ABSTOL_UPDATE",
};

function invalid(message: string): never {
  throw new ChronoError("persisted_ledger_invalid", message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Expected object.");
  }
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (
    Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))
  ) invalid("Unexpected persisted object shape.");
}
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid("Expected finite number.");
  }
  return value;
}
function tuple(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) {
    invalid("Unexpected numeric tuple.");
  }
  return value.map(finite);
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    invalid("Invalid persisted timestamp.");
  }
  try {
    if (new Date(value).toISOString() !== value) {
      invalid("Invalid persisted timestamp.");
    }
  } catch {
    invalid("Invalid persisted timestamp.");
  }
  return value;
}
function request(value: unknown, requestedId: string): RunRequest {
  const raw = object(value);
  const allowed = ["request_id", "case_sha256", "case_uri", "timeout_ms"];
  if (
    Object.keys(raw).some((key) => !allowed.includes(key)) || !("request_id" in raw) ||
    !("case_sha256" in raw)
  ) invalid("Invalid persisted request.");
  if (
    raw.request_id !== requestedId || typeof raw.request_id !== "string" ||
    !REQUEST_ID.test(raw.request_id)
  ) invalid("Persisted request id is inconsistent.");
  const case_sha256 = requireSha256(raw.case_sha256);
  const expectedUri = `${CASE_URI_PREFIX}${case_sha256}`;
  if (raw.case_uri !== undefined && raw.case_uri !== expectedUri) {
    invalid("Persisted case URI is inconsistent.");
  }
  const timeout_ms = raw.timeout_ms;
  if (
    timeout_ms !== undefined &&
    (typeof timeout_ms !== "number" || !Number.isSafeInteger(timeout_ms) ||
      timeout_ms < 100 || timeout_ms > 60_000)
  ) invalid("Persisted timeout is invalid.");
  return {
    request_id: raw.request_id,
    case_sha256,
    ...(raw.case_uri === undefined ? {} : { case_uri: raw.case_uri as string }),
    ...(timeout_ms === undefined ? {} : { timeout_ms }),
  };
}
function runtime(value: unknown): RunObservation["runtime"] {
  const raw = object(value);
  exactKeys(raw, ["binding", "python_version"]);
  if (
    raw.binding !== "pychrono" || typeof raw.python_version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(raw.python_version)
  ) invalid("Persisted runtime identity is invalid.");
  return { binding: "pychrono", python_version: raw.python_version };
}
function observation(value: unknown, input: PrescribedKinematicsCase): RunObservation {
  const raw = object(value);
  exactKeys(raw, [
    "engine",
    "runtime",
    "samples",
    "not_evaluated",
    "execution_state",
    "kinematics_exit",
  ]);
  const engine = object(raw.engine);
  exactKeys(engine, ["name", "version"]);
  if (engine.name !== "Project Chrono" || engine.version !== "10.0.0") {
    invalid("Persisted engine identity is invalid.");
  }
  const persistedRuntime = runtime(raw.runtime);
  if (
    !Array.isArray(raw.not_evaluated) ||
    raw.not_evaluated.length !== NOT_EVALUATED.length ||
    raw.not_evaluated.some((entry, index) => entry !== NOT_EVALUATED[index])
  ) invalid("Persisted non-evaluation boundary is invalid.");
  if (raw.execution_state !== "completed" && raw.execution_state !== "not_converged") {
    invalid("Persisted execution state is invalid.");
  }
  const exit = object(raw.kinematics_exit);
  exactKeys(exit, ["raw_code", "raw_name"]);
  if (!Number.isInteger(exit.raw_code) || !Number.isFinite(exit.raw_code)) {
    invalid("Persisted exit code is invalid.");
  }
  if (typeof exit.raw_name !== "string") invalid("Persisted exit name is invalid.");
  if (
    EXIT_FLAG_NAMES[exit.raw_code as number] !== exit.raw_name
  ) invalid("Persisted raw exit code and name are inconsistent.");
  if (
    (raw.execution_state === "not_converged") !== (exit.raw_name === "NOT_CONVERGED")
  ) invalid("Persisted execution state contradicts exit state.");
  if (
    !Array.isArray(raw.samples) || raw.samples.length < 1 || raw.samples.length > 512
  ) invalid("Persisted sample count is invalid.");
  let previous = -1;
  for (const sampleValue of raw.samples) {
    const sample = object(sampleValue);
    exactKeys(sample, ["time_s", "bodies", "motors"]);
    const time = finite(sample.time_s);
    if (!(time > previous)) invalid("Persisted sample times are not ordered.");
    previous = time;
    if (
      !Array.isArray(sample.bodies) || sample.bodies.length !== input.bodies.length ||
      !Array.isArray(sample.motors) || sample.motors.length !== input.joints.length
    ) invalid("Persisted sample cardinality is invalid.");
    sample.bodies.forEach((bodyValue, index) => {
      const body = object(bodyValue);
      exactKeys(body, ["id", "position_m", "rotation_wxyz"]);
      if (body.id !== input.bodies[index].id) {
        invalid("Persisted body identity is invalid.");
      }
      tuple(body.position_m, 3);
      const rotation = tuple(body.rotation_wxyz, 4);
      if (Math.abs(Math.hypot(...rotation) - 1) > 1e-5) {
        invalid("Persisted body rotation is invalid.");
      }
    });
    sample.motors.forEach((motorValue, index) => {
      const motor = object(motorValue);
      const allowed = [
        "joint_id",
        "declared_limit_observation",
        "translation_residual_m",
        "rotation_quaternion_imag_residual",
        "motor_angle_rad",
      ];
      if (
        Object.keys(motor).some((key) => !allowed.includes(key)) ||
        [
          "joint_id",
          "declared_limit_observation",
          "translation_residual_m",
          "rotation_quaternion_imag_residual",
        ].some((key) => !(key in motor))
      ) invalid("Persisted motor shape is invalid.");
      if (
        motor.joint_id !== input.joints[index].id ||
        !["below", "within", "above"].includes(
          motor.declared_limit_observation as string,
        )
      ) invalid("Persisted motor identity is invalid.");
      tuple(motor.translation_residual_m, 3);
      tuple(motor.rotation_quaternion_imag_residual, 3);
      if (!("motor_angle_rad" in motor)) invalid("Persisted motor angle is absent.");
      const motorAngle = finite(motor.motor_angle_rad);
      const [lower, upper] = input.joints[index].limits_rad;
      const expectedRelation = motorAngle < lower
        ? "below"
        : motorAngle > upper
        ? "above"
        : "within";
      if (motor.declared_limit_observation !== expectedRelation) {
        invalid("Persisted motor limit observation is inconsistent.");
      }
    });
  }
  if ((raw.samples[0] as Record<string, unknown>).time_s !== 0) {
    invalid("Persisted samples must begin at t=0.");
  }
  if (
    raw.execution_state === "completed" && Math.abs(previous - input.duration_s) > 1e-9
  ) invalid("Persisted completed run lacks final sample.");
  return {
    engine: { name: "Project Chrono", version: "10.0.0" },
    runtime: persistedRuntime,
    samples: raw.samples as RunObservation["samples"],
    not_evaluated: NOT_EVALUATED,
    execution_state: raw.execution_state as RunObservation["execution_state"],
    kinematics_exit: {
      raw_code: exit.raw_code as number,
      raw_name: exit.raw_name as string,
    },
  };
}

function receipt(value: unknown): RunReceipt {
  const raw = object(value);
  exactKeys(raw, [
    "schema_id",
    "receipt_sha256",
    "case_sha256",
    "outcome_sha256",
    "request_id",
    "recorded_at",
    "package",
    "provider",
    "worker",
    "runtime",
    "execution_state",
    "kinematics_exit",
  ]);
  if (raw.schema_id !== RECEIPT_SCHEMA_ID) {
    invalid("Persisted receipt schema is invalid.");
  }
  const request_id =
    typeof raw.request_id === "string" && REQUEST_ID.test(raw.request_id)
      ? raw.request_id
      : invalid("Persisted receipt request id is invalid.");
  const packageIdentity = object(raw.package);
  exactKeys(packageIdentity, ["name", "version"]);
  const providerIdentity = object(raw.provider);
  exactKeys(providerIdentity, ["name", "version"]);
  if (
    packageIdentity.name !== "@casys/mcp-chrono" ||
    packageIdentity.version !== PROVIDER_VERSION ||
    providerIdentity.name !== "casys-chrono" ||
    providerIdentity.version !== PROVIDER_VERSION
  ) invalid("Persisted receipt package identity is invalid.");
  const worker = object(raw.worker);
  exactKeys(worker, ["source_sha256"]);
  const execution_state = raw.execution_state === "completed" ||
      raw.execution_state === "not_converged"
    ? raw.execution_state
    : invalid("Persisted receipt execution state is invalid.");
  const exit = object(raw.kinematics_exit);
  exactKeys(exit, ["raw_code", "raw_name"]);
  if (
    typeof exit.raw_code !== "number" || !Number.isInteger(exit.raw_code) ||
    typeof exit.raw_name !== "string" ||
    EXIT_FLAG_NAMES[exit.raw_code] !== exit.raw_name
  ) invalid("Persisted receipt raw exit is invalid.");
  return {
    schema_id: RECEIPT_SCHEMA_ID,
    receipt_sha256: requireSha256(raw.receipt_sha256),
    case_sha256: requireSha256(raw.case_sha256),
    outcome_sha256: requireSha256(raw.outcome_sha256),
    request_id,
    recorded_at: timestamp(raw.recorded_at),
    package: { name: "@casys/mcp-chrono", version: PROVIDER_VERSION },
    provider: { name: "casys-chrono", version: PROVIDER_VERSION },
    worker: { source_sha256: requireSha256(worker.source_sha256) },
    runtime: runtime(raw.runtime),
    execution_state,
    kinematics_exit: { raw_code: exit.raw_code, raw_name: exit.raw_name },
  };
}

export function persistedRecordCaseSha256(value: unknown, requestedId: string): string {
  const raw = object(value);
  exactKeys(raw, ["request", "case_uri", "recorded_at", "output", "receipt"]);
  return request(raw.request, requestedId).case_sha256;
}
export function validatePersistedIntent(
  value: unknown,
  requestedId: string,
): RunIntent {
  const raw = object(value);
  exactKeys(raw, ["request", "case_uri", "intent_recorded_at"]);
  const parsedRequest = request(raw.request, requestedId);
  if (raw.case_uri !== `${CASE_URI_PREFIX}${parsedRequest.case_sha256}`) {
    invalid("Persisted intent URI is inconsistent.");
  }
  return {
    request: parsedRequest,
    case_uri: raw.case_uri as string,
    intent_recorded_at: timestamp(raw.intent_recorded_at),
  };
}
export async function validatePersistedRecord(
  value: unknown,
  requestedId: string,
  input: PrescribedKinematicsCase,
): Promise<RunRecord> {
  const raw = object(value);
  exactKeys(raw, ["request", "case_uri", "recorded_at", "output", "receipt"]);
  const parsedRequest = request(raw.request, requestedId);
  if (raw.case_uri !== `${CASE_URI_PREFIX}${parsedRequest.case_sha256}`) {
    invalid("Persisted record URI is inconsistent.");
  }
  const recorded_at = timestamp(raw.recorded_at);
  const output = observation(raw.output, input);
  const parsedReceipt = receipt(raw.receipt);
  if (
    parsedReceipt.request_id !== parsedRequest.request_id ||
    parsedReceipt.case_sha256 !== parsedRequest.case_sha256 ||
    parsedReceipt.recorded_at !== recorded_at ||
    parsedReceipt.execution_state !== output.execution_state ||
    parsedReceipt.kinematics_exit.raw_code !== output.kinematics_exit.raw_code ||
    parsedReceipt.kinematics_exit.raw_name !== output.kinematics_exit.raw_name ||
    parsedReceipt.runtime.binding !== output.runtime.binding ||
    parsedReceipt.runtime.python_version !== output.runtime.python_version
  ) invalid("Persisted receipt does not match its run record.");
  await verifyRunReceipt(
    parsedReceipt,
    parsedRequest.case_sha256,
    parsedRequest,
    recorded_at,
    output,
  );
  return {
    request: parsedRequest,
    case_uri: raw.case_uri as string,
    recorded_at,
    output,
    receipt: parsedReceipt,
  };
}
