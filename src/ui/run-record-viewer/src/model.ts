import {
  CHRONO_VERSION,
  PROVIDER_VERSION,
  RECEIPT_SCHEMA_ID,
} from "../../../domain/types.ts";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CASE_URI_PATTERN = /^chrono-case:sha256:[a-f0-9]{64}$/;
const PYTHON_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
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
const KINEMATICS_EXITS = [
  [0, "NOT_CONVERGED"],
  [1, "SUCCESS"],
  [2, "ABSTOL_RESIDUAL"],
  [3, "RELTOL_UPDATE"],
  [4, "ABSTOL_UPDATE"],
] as const;

export type ChronoExecutionState = "completed" | "not_converged";
export type DeclaredLimitObservation = "below" | "within" | "above";

export interface ChronoKinematicsExit {
  readonly raw_code: number;
  readonly raw_name: string;
}

export interface ChronoRunRequest {
  readonly request_id: string;
  readonly case_sha256: string;
  readonly case_uri?: string;
  readonly timeout_ms?: number;
}

export interface ChronoRunIntent {
  readonly request: ChronoRunRequest;
  readonly case_uri: string;
  readonly intent_recorded_at: string;
}

export interface ChronoBodyObservation {
  readonly id: string;
  readonly position_m: readonly [number, number, number];
  readonly rotation_wxyz: readonly [number, number, number, number];
}

export interface ChronoMotorObservation {
  readonly joint_id: string;
  readonly motor_angle_rad: number;
  readonly declared_limit_observation: DeclaredLimitObservation;
  readonly translation_residual_m: readonly [number, number, number];
  readonly rotation_quaternion_imag_residual: readonly [number, number, number];
}

export interface ChronoKinematicsSample {
  readonly time_s: number;
  readonly bodies: readonly ChronoBodyObservation[];
  readonly motors: readonly ChronoMotorObservation[];
}

export interface ChronoSamplePage {
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
  readonly returned: number;
  readonly has_more: boolean;
  readonly samples: readonly ChronoKinematicsSample[];
}

export interface ChronoRunReceipt {
  readonly schema_id: typeof RECEIPT_SCHEMA_ID;
  readonly receipt_sha256: string;
  readonly case_sha256: string;
  readonly outcome_sha256: string;
  readonly request_id: string;
  readonly recorded_at: string;
  readonly package: { readonly name: "@casys/mcp-chrono"; readonly version: string };
  readonly provider: { readonly name: "casys-chrono"; readonly version: string };
  readonly worker: { readonly source_sha256: string };
  readonly runtime: { readonly binding: "pychrono"; readonly python_version: string };
  readonly server_runtime: { readonly deno_version: string };
  readonly execution_state: ChronoExecutionState;
  readonly kinematics_exit: ChronoKinematicsExit;
}

export interface ChronoObservationSummary {
  readonly engine: { readonly name: "Project Chrono"; readonly version: string };
  readonly runtime: ChronoRunReceipt["runtime"];
  readonly execution_state: ChronoExecutionState;
  readonly kinematics_exit: ChronoKinematicsExit;
  readonly not_evaluated: typeof NOT_EVALUATED;
  readonly sample_count: number;
  readonly sample_time_range_s: { readonly first: number; readonly last: number };
}

/** Complete durable observation used only by the recorded session contract. */
export interface ChronoFullObservation {
  readonly engine: { readonly name: "Project Chrono"; readonly version: string };
  readonly runtime: ChronoRunReceipt["runtime"];
  readonly samples: readonly ChronoKinematicsSample[];
  readonly not_evaluated: typeof NOT_EVALUATED;
  readonly execution_state: ChronoExecutionState;
  readonly kinematics_exit: ChronoKinematicsExit;
}

export interface ChronoRunRecordView {
  readonly request: ChronoRunRequest;
  readonly case_uri: string;
  readonly recorded_at: string;
  readonly receipt: ChronoRunReceipt;
  readonly observation: ChronoObservationSummary;
  readonly sample_page: ChronoSamplePage;
}

/** Exact provider-owned record.json projection transported by viewer.session.apply. */
export interface ChronoDurableRunRecord {
  readonly request: ChronoRunRequest;
  readonly case_uri: string;
  readonly recorded_at: string;
  readonly output: ChronoFullObservation;
  readonly receipt: ChronoRunReceipt;
}

export type ChronoRunView =
  | {
    readonly kind: "recorded";
    readonly replayed?: boolean;
    readonly record: ChronoRunRecordView;
  }
  | { readonly kind: "uncertain"; readonly intent: ChronoRunIntent }
  | { readonly kind: "absent" };

export type DisplayState =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "unresolved"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | ChronoRunView;

export function isRecordedRun(
  view: ChronoRunView,
): view is Extract<ChronoRunView, { kind: "recorded" }> {
  return view.kind === "recorded";
}

/** Parse the closed run/readback structuredContent family. */
export function parseChronoRunView(value: unknown): ChronoRunView {
  const root = record(value, "structuredContent");
  if (root.ok !== true) {
    throw new TypeError("Chrono viewer results require ok: true.");
  }
  if (root.state === "absent") {
    exactKeys(root, ["ok", "state"], "structuredContent");
    return { kind: "absent" };
  }
  if (root.state === "uncertain") {
    exactKeys(root, ["ok", "state", "intent"], "structuredContent");
    return { kind: "uncertain", intent: parseIntent(root.intent) };
  }
  if (root.state === "recorded") {
    exactKeys(root, ["ok", "state", "record"], "structuredContent");
    return { kind: "recorded", record: parseChronoRunRecordView(root.record) };
  }
  if (root.state !== undefined) {
    throw new TypeError("Chrono run state must be recorded, uncertain or absent.");
  }
  if ("replayed" in root) {
    exactKeys(root, ["ok", "replayed", "record"], "structuredContent");
    if (typeof root.replayed !== "boolean") {
      throw new TypeError("replayed must be a boolean.");
    }
    return {
      kind: "recorded",
      replayed: root.replayed,
      record: parseChronoRunRecordView(root.record),
    };
  }
  exactKeys(root, ["ok", "record"], "structuredContent");
  return { kind: "recorded", record: parseChronoRunRecordView(root.record) };
}

export function displayStateFromToolResult(value: unknown): DisplayState {
  const result = record(value, "tool result");
  if (result.isError === true) {
    return { kind: "error", message: toolErrorMessage(result) };
  }
  const structured = result.structuredContent !== undefined
    ? (isRecord(result.structuredContent) ? result.structuredContent : undefined)
    : jsonTextFallback(result.content);
  if (structured === undefined) return { kind: "empty" };
  try {
    return parseChronoRunView(structured);
  } catch (error) {
    throw new TypeError(
      `Unsupported Chrono viewer result: ${errorMessage(error)}`,
    );
  }
}

export function toolErrorMessage(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return "The Chrono tool reported an error.";
  }
  const text = value.content.find((item) => isRecord(item) && item.type === "text")
    ?.text;
  return typeof text === "string" && text.trim()
    ? text
    : "The Chrono tool reported an error.";
}

/** Render provider numbers without relabelling them to a target duration. */
export function formatExactNumber(value: number): string {
  return JSON.stringify(value);
}

export function formatExactVector(values: readonly number[]): string {
  return `[${values.map(formatExactNumber).join(", ")}]`;
}

export function parseChronoRunRecordView(value: unknown): ChronoRunRecordView {
  const root = exactRecord(value, [
    "request",
    "case_uri",
    "recorded_at",
    "receipt",
    "observation",
    "sample_page",
  ], "record");
  const request = parseRequest(root.request, "record.request");
  const case_uri = caseUri(root.case_uri, "record.case_uri");
  const recorded_at = nonEmptyString(root.recorded_at, "record.recorded_at");
  const receipt = parseReceipt(root.receipt);
  const observation = parseObservation(root.observation);
  const sample_page = parseSamplePage(root.sample_page);
  assertRequestCaseUri(request, case_uri, "record");
  if (receipt.request_id !== request.request_id) {
    throw new TypeError("Receipt request_id differs from the recorded request.");
  }
  if (receipt.case_sha256 !== request.case_sha256) {
    throw new TypeError("Receipt case_sha256 differs from the recorded request.");
  }
  if (receipt.recorded_at !== recorded_at) {
    throw new TypeError("Receipt recorded_at differs from the record.");
  }
  if (receipt.execution_state !== observation.execution_state) {
    throw new TypeError("Receipt execution_state differs from the observation.");
  }
  if (
    receipt.kinematics_exit.raw_code !== observation.kinematics_exit.raw_code ||
    receipt.kinematics_exit.raw_name !== observation.kinematics_exit.raw_name
  ) {
    throw new TypeError("Receipt kinematics_exit differs from the observation.");
  }
  if (observation.sample_count !== sample_page.total) {
    throw new TypeError("Observation sample_count differs from sample_page.total.");
  }
  return { request, case_uri, recorded_at, receipt, observation, sample_page };
}

/** Parse one complete durable record without weakening its provider joins. */
export function parseChronoDurableRunRecord(
  value: unknown,
): ChronoDurableRunRecord {
  const root = exactRecord(value, [
    "request",
    "case_uri",
    "recorded_at",
    "output",
    "receipt",
  ], "recorded run");
  const request = parseRequest(root.request, "recorded run.request");
  const case_uri = caseUri(root.case_uri, "recorded run.case_uri");
  const recorded_at = nonEmptyString(
    root.recorded_at,
    "recorded run.recorded_at",
  );
  const output = parseChronoFullObservation(root.output);
  const receipt = parseReceipt(root.receipt);
  assertRequestCaseUri(request, case_uri, "recorded run");
  if (
    receipt.request_id !== request.request_id ||
    receipt.case_sha256 !== request.case_sha256 ||
    receipt.recorded_at !== recorded_at
  ) {
    throw new TypeError(
      "Recorded receipt identity differs from its durable run record.",
    );
  }
  if (
    receipt.runtime.binding !== output.runtime.binding ||
    receipt.runtime.python_version !== output.runtime.python_version ||
    receipt.execution_state !== output.execution_state ||
    receipt.kinematics_exit.raw_code !== output.kinematics_exit.raw_code ||
    receipt.kinematics_exit.raw_name !== output.kinematics_exit.raw_name
  ) {
    throw new TypeError(
      "Recorded receipt execution facts differ from the durable outcome.",
    );
  }
  return { request, case_uri, recorded_at, output, receipt };
}

/** Project the exact durable record to the existing bounded one-object view. */
export function chronoRunViewFromDurableRecord(
  record: ChronoDurableRunRecord,
): ChronoRunView {
  const samples = record.output.samples;
  const first = samples[0]!;
  const last = samples.at(-1)!;
  const pageSamples = samples.slice(0, 16);
  const view: ChronoRunRecordView = {
    request: record.request,
    case_uri: record.case_uri,
    recorded_at: record.recorded_at,
    receipt: record.receipt,
    observation: {
      engine: record.output.engine,
      runtime: record.output.runtime,
      execution_state: record.output.execution_state,
      kinematics_exit: record.output.kinematics_exit,
      not_evaluated: record.output.not_evaluated,
      sample_count: samples.length,
      sample_time_range_s: { first: first.time_s, last: last.time_s },
    },
    sample_page: {
      offset: 0,
      limit: 16,
      total: samples.length,
      returned: pageSamples.length,
      has_more: pageSamples.length < samples.length,
      samples: pageSamples,
    },
  };
  return { kind: "recorded", record: parseChronoRunRecordView(view) };
}

function parseIntent(value: unknown): ChronoRunIntent {
  const root = exactRecord(
    value,
    ["request", "case_uri", "intent_recorded_at"],
    "intent",
  );
  const request = parseRequest(root.request, "intent.request");
  const case_uri = caseUri(root.case_uri, "intent.case_uri");
  assertRequestCaseUri(request, case_uri, "intent");
  return {
    request,
    case_uri,
    intent_recorded_at: nonEmptyString(
      root.intent_recorded_at,
      "intent.intent_recorded_at",
    ),
  };
}

function parseRequest(value: unknown, name: string): ChronoRunRequest {
  const root = record(value, name);
  const keys = ["request_id", "case_sha256"];
  if (root.case_uri !== undefined) keys.push("case_uri");
  if (root.timeout_ms !== undefined) keys.push("timeout_ms");
  exactKeys(root, keys, name);
  const request: ChronoRunRequest = {
    request_id: requestId(root.request_id, `${name}.request_id`),
    case_sha256: sha256(root.case_sha256, `${name}.case_sha256`),
    ...(root.case_uri === undefined
      ? {}
      : { case_uri: caseUri(root.case_uri, `${name}.case_uri`) }),
    ...(root.timeout_ms === undefined ? {} : {
      timeout_ms: integerInRange(root.timeout_ms, 100, 60000, `${name}.timeout_ms`),
    }),
  };
  return request;
}

function parseReceipt(value: unknown): ChronoRunReceipt {
  const root = exactRecord(value, [
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
    "server_runtime",
    "execution_state",
    "kinematics_exit",
  ], "receipt");
  if (root.schema_id !== RECEIPT_SCHEMA_ID) {
    throw new TypeError(`receipt.schema_id must be ${RECEIPT_SCHEMA_ID}.`);
  }
  const pkg = exactRecord(root.package, ["name", "version"], "receipt.package");
  if (pkg.name !== "@casys/mcp-chrono" || pkg.version !== PROVIDER_VERSION) {
    throw new TypeError("receipt.package is not this provider identity.");
  }
  const provider = exactRecord(
    root.provider,
    ["name", "version"],
    "receipt.provider",
  );
  if (provider.name !== "casys-chrono" || provider.version !== PROVIDER_VERSION) {
    throw new TypeError("receipt.provider is not this provider identity.");
  }
  const worker = exactRecord(root.worker, ["source_sha256"], "receipt.worker");
  const server = exactRecord(
    root.server_runtime,
    ["deno_version"],
    "receipt.server_runtime",
  );
  return {
    schema_id: RECEIPT_SCHEMA_ID,
    receipt_sha256: sha256(root.receipt_sha256, "receipt.receipt_sha256"),
    case_sha256: sha256(root.case_sha256, "receipt.case_sha256"),
    outcome_sha256: sha256(root.outcome_sha256, "receipt.outcome_sha256"),
    request_id: requestId(root.request_id, "receipt.request_id"),
    recorded_at: nonEmptyString(root.recorded_at, "receipt.recorded_at"),
    package: { name: "@casys/mcp-chrono", version: PROVIDER_VERSION },
    provider: { name: "casys-chrono", version: PROVIDER_VERSION },
    worker: {
      source_sha256: sha256(worker.source_sha256, "receipt.worker.source_sha256"),
    },
    runtime: parseRuntime(root.runtime, "receipt.runtime"),
    server_runtime: {
      deno_version: pythonVersion(
        server.deno_version,
        "receipt.server_runtime.deno_version",
      ),
    },
    execution_state: executionState(
      root.execution_state,
      "receipt.execution_state",
    ),
    kinematics_exit: kinematicsExit(
      root.kinematics_exit,
      "receipt.kinematics_exit",
    ),
  };
}

export function parseChronoFullObservation(
  value: unknown,
): ChronoFullObservation {
  const root = exactRecord(value, [
    "engine",
    "runtime",
    "samples",
    "not_evaluated",
    "execution_state",
    "kinematics_exit",
  ], "recorded outcome");
  const engine = exactRecord(
    root.engine,
    ["name", "version"],
    "recorded outcome.engine",
  );
  if (engine.name !== "Project Chrono" || engine.version !== CHRONO_VERSION) {
    throw new TypeError(
      "recorded outcome.engine is not Project Chrono 10.0.0.",
    );
  }
  if (!Array.isArray(root.samples)) {
    throw new TypeError("recorded outcome.samples must be an array.");
  }
  if (
    root.samples.length < 1 || root.samples.length > 512 ||
    Object.keys(root.samples).length !== root.samples.length
  ) {
    throw new TypeError(
      "recorded outcome.samples must be a dense array of 1 through 512 samples.",
    );
  }
  const samples = root.samples.map((sample, index) =>
    parseSample(sample, `recorded outcome.samples[${index}]`)
  );
  if (samples[0]!.time_s !== 0) {
    throw new TypeError("recorded outcome.samples must begin at t=0.");
  }
  for (let index = 1; index < samples.length; index++) {
    if (samples[index]!.time_s <= samples[index - 1]!.time_s) {
      throw new TypeError(
        "recorded outcome sample times must be strictly increasing.",
      );
    }
  }
  return {
    engine: { name: "Project Chrono", version: CHRONO_VERSION },
    runtime: parseRuntime(root.runtime, "recorded outcome.runtime"),
    samples,
    not_evaluated: parseNotEvaluated(root.not_evaluated),
    execution_state: executionState(
      root.execution_state,
      "recorded outcome.execution_state",
    ),
    kinematics_exit: kinematicsExit(
      root.kinematics_exit,
      "recorded outcome.kinematics_exit",
    ),
  };
}

function parseObservation(value: unknown): ChronoObservationSummary {
  const root = exactRecord(value, [
    "engine",
    "runtime",
    "execution_state",
    "kinematics_exit",
    "not_evaluated",
    "sample_count",
    "sample_time_range_s",
  ], "observation");
  const engine = exactRecord(root.engine, ["name", "version"], "observation.engine");
  if (engine.name !== "Project Chrono" || engine.version !== CHRONO_VERSION) {
    throw new TypeError("observation.engine is not Project Chrono 10.0.0.");
  }
  const range = exactRecord(
    root.sample_time_range_s,
    ["first", "last"],
    "observation.sample_time_range_s",
  );
  const notEvaluated = parseNotEvaluated(root.not_evaluated);
  return {
    engine: { name: "Project Chrono", version: CHRONO_VERSION },
    runtime: parseRuntime(root.runtime, "observation.runtime"),
    execution_state: executionState(
      root.execution_state,
      "observation.execution_state",
    ),
    kinematics_exit: kinematicsExit(
      root.kinematics_exit,
      "observation.kinematics_exit",
    ),
    not_evaluated: notEvaluated,
    sample_count: integerInRange(root.sample_count, 1, 512, "observation.sample_count"),
    sample_time_range_s: {
      first: finiteNumber(range.first, "observation.sample_time_range_s.first"),
      last: finiteNumber(range.last, "observation.sample_time_range_s.last"),
    },
  };
}

function parseSamplePage(value: unknown): ChronoSamplePage {
  const root = exactRecord(value, [
    "offset",
    "limit",
    "total",
    "returned",
    "has_more",
    "samples",
  ], "sample_page");
  const offset = integerInRange(root.offset, 0, 511, "sample_page.offset");
  const limit = integerInRange(root.limit, 1, 64, "sample_page.limit");
  const total = integerInRange(root.total, 1, 512, "sample_page.total");
  const returned = integerInRange(root.returned, 0, 64, "sample_page.returned");
  if (returned > limit) {
    throw new TypeError("sample_page.returned exceeds sample_page.limit.");
  }
  if (typeof root.has_more !== "boolean") {
    throw new TypeError("sample_page.has_more must be a boolean.");
  }
  if (!Array.isArray(root.samples)) {
    throw new TypeError("sample_page.samples must be an array.");
  }
  if (root.samples.length > 64) {
    throw new TypeError("sample_page.samples exceeds the bounded page.");
  }
  if (root.samples.length !== returned) {
    throw new TypeError("sample_page.returned differs from samples.length.");
  }
  const samples = root.samples.map((sample, index) =>
    parseSample(sample, `sample_page.samples[${index}]`)
  );
  const consumed = offset + returned;
  if (consumed > total) {
    throw new TypeError("sample_page offset and returned exceed total.");
  }
  if (root.has_more !== consumed < total) {
    throw new TypeError(
      "sample_page.has_more does not match offset, returned and total.",
    );
  }
  return { offset, limit, total, returned, has_more: root.has_more, samples };
}

function parseSample(value: unknown, name: string): ChronoKinematicsSample {
  const root = exactRecord(value, ["time_s", "bodies", "motors"], name);
  if (!Array.isArray(root.bodies) || !Array.isArray(root.motors)) {
    throw new TypeError(`${name} bodies and motors must be arrays.`);
  }
  if (root.bodies.length > 16 || root.motors.length > 15) {
    throw new TypeError(`${name} exceeds the bounded body or motor count.`);
  }
  return {
    time_s: finiteNumber(root.time_s, `${name}.time_s`),
    bodies: root.bodies.map((body, index) =>
      parseBody(body, `${name}.bodies[${index}]`)
    ),
    motors: root.motors.map((motor, index) =>
      parseMotor(motor, `${name}.motors[${index}]`)
    ),
  };
}

function parseBody(value: unknown, name: string): ChronoBodyObservation {
  const root = exactRecord(value, ["id", "position_m", "rotation_wxyz"], name);
  return {
    id: nonEmptyString(root.id, `${name}.id`),
    position_m: vector3(root.position_m, `${name}.position_m`),
    rotation_wxyz: quaternion(root.rotation_wxyz, `${name}.rotation_wxyz`),
  };
}

function parseMotor(value: unknown, name: string): ChronoMotorObservation {
  const root = exactRecord(value, [
    "joint_id",
    "motor_angle_rad",
    "declared_limit_observation",
    "translation_residual_m",
    "rotation_quaternion_imag_residual",
  ], name);
  const observation = root.declared_limit_observation;
  if (
    observation !== "below" && observation !== "within" && observation !== "above"
  ) {
    throw new TypeError(
      `${name}.declared_limit_observation must be below, within or above.`,
    );
  }
  return {
    joint_id: nonEmptyString(root.joint_id, `${name}.joint_id`),
    motor_angle_rad: finiteNumber(root.motor_angle_rad, `${name}.motor_angle_rad`),
    declared_limit_observation: observation,
    translation_residual_m: vector3(
      root.translation_residual_m,
      `${name}.translation_residual_m`,
    ),
    rotation_quaternion_imag_residual: vector3(
      root.rotation_quaternion_imag_residual,
      `${name}.rotation_quaternion_imag_residual`,
    ),
  };
}

function parseRuntime(
  value: unknown,
  name: string,
): ChronoRunReceipt["runtime"] {
  const root = exactRecord(value, ["binding", "python_version"], name);
  if (root.binding !== "pychrono") {
    throw new TypeError(`${name}.binding must be pychrono.`);
  }
  return {
    binding: "pychrono",
    python_version: pythonVersion(root.python_version, `${name}.python_version`),
  };
}

function parseNotEvaluated(value: unknown): typeof NOT_EVALUATED {
  if (!Array.isArray(value) || value.length !== NOT_EVALUATED.length) {
    throw new TypeError("observation.not_evaluated must be the literal list.");
  }
  for (let index = 0; index < NOT_EVALUATED.length; index++) {
    if (value[index] !== NOT_EVALUATED[index]) {
      throw new TypeError("observation.not_evaluated must be the literal list.");
    }
  }
  return NOT_EVALUATED;
}

function kinematicsExit(value: unknown, name: string): ChronoKinematicsExit {
  const root = exactRecord(value, ["raw_code", "raw_name"], name);
  for (const [raw_code, raw_name] of KINEMATICS_EXITS) {
    if (root.raw_code === raw_code && root.raw_name === raw_name) {
      return { raw_code, raw_name };
    }
  }
  throw new TypeError(`${name} is not a native kinematics exit pair.`);
}

function executionState(value: unknown, name: string): ChronoExecutionState {
  if (value !== "completed" && value !== "not_converged") {
    throw new TypeError(`${name} must be completed or not_converged.`);
  }
  return value;
}

function jsonTextFallback(
  content: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (
      !isRecord(item) || item.type !== "text" || typeof item.text !== "string"
    ) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(item.text);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Human-readable summaries remain valid text blocks; try the next block.
    }
  }
  return undefined;
}

function requestId(value: unknown, name: string): string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 128 ||
    !REQUEST_ID_PATTERN.test(value)
  ) {
    throw new TypeError(`${name} is not a request_id.`);
  }
  return value;
}

function assertRequestCaseUri(
  request: ChronoRunRequest,
  caseUri: string,
  name: string,
): void {
  const expected = `chrono-case:sha256:${request.case_sha256}`;
  if (
    caseUri !== expected ||
    (request.case_uri !== undefined && request.case_uri !== caseUri)
  ) {
    throw new TypeError(`${name}.case_uri differs from the recorded request identity.`);
  }
}

function sha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function caseUri(value: unknown, name: string): string {
  if (typeof value !== "string" || !CASE_URI_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a chrono-case SHA-256 URI.`);
  }
  return value;
}

function pythonVersion(value: unknown, name: string): string {
  if (typeof value !== "string" || !PYTHON_VERSION_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a dotted version.`);
  }
  return value;
}

function integerInRange(
  value: unknown,
  min: number,
  max: number,
  name: string,
): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) {
    throw new TypeError(`${name} must be an integer from ${min} through ${max}.`);
  }
  return value;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

function vector3(
  value: unknown,
  name: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${name} must have three finite numbers.`);
  }
  return [
    finiteNumber(value[0], `${name}[0]`),
    finiteNumber(value[1], `${name}[1]`),
    finiteNumber(value[2], `${name}[2]`),
  ];
}

function quaternion(
  value: unknown,
  name: string,
): readonly [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new TypeError(`${name} must have four finite numbers.`);
  }
  return [
    finiteNumber(value[0], `${name}[0]`),
    finiteNumber(value[1], `${name}[1]`),
    finiteNumber(value[2], `${name}[2]`),
    finiteNumber(value[3], `${name}[3]`),
  ];
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  const root = record(value, name);
  exactKeys(root, keys, name);
  return root;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${name} contains missing or unsupported fields.`);
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
