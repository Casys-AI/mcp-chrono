import {
  AGENT_WORKFLOW,
  CASE_INVARIANTS,
  CASE_JSON_SCHEMA,
  CASE_TEMPLATE,
  INPUT_POSE_SEMANTICS,
  NON_CLAIMS,
  RECEIPT_CONTRACT,
  RESULT_PAGING_CONTRACT,
  SUBMISSION_CONTRACT,
} from "../domain/contract.ts";
import {
  CASE_SCHEMA_ID,
  CHRONO_VERSION,
  PROVIDER_VERSION,
  RECEIPT_SCHEMA_ID,
} from "../domain/types.ts";

const sha256Schema = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
const requestIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
} as const;
const caseUriSchema = {
  type: "string",
  pattern: "^chrono-case:sha256:[a-f0-9]{64}$",
} as const;
const vector3Schema = {
  type: "array",
  minItems: 3,
  maxItems: 3,
  items: { type: "number" },
} as const;
const quaternionSchema = {
  type: "array",
  minItems: 4,
  maxItems: 4,
  items: { type: "number" },
} as const;

const errorDetailsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    expected_case_sha256: sha256Schema,
    actual_case_sha256: sha256Schema,
    request_id: requestIdSchema,
    code: { type: "integer" },
    stderr: { type: "string" },
  },
} as const;
const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { type: "string", minLength: 1 },
    message: { type: "string", minLength: 1 },
    details: errorDetailsSchema,
  },
} as const;
export const failureSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "error"],
  properties: { ok: { const: false }, error: errorSchema },
} as const;

const engineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version"],
  properties: {
    name: { const: "Project Chrono" },
    version: { const: CHRONO_VERSION },
  },
} as const;
const runtimeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["binding", "python_version"],
  properties: {
    binding: { const: "pychrono" },
    python_version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
  },
} as const;
const serverRuntimeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["deno_version"],
  properties: { deno_version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" } },
} as const;
const kinematicsExitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["raw_code", "raw_name"],
  properties: {
    raw_code: { type: "integer" },
    raw_name: { type: "string" },
  },
  oneOf: [
    { properties: { raw_code: { const: 0 }, raw_name: { const: "NOT_CONVERGED" } } },
    { properties: { raw_code: { const: 1 }, raw_name: { const: "SUCCESS" } } },
    { properties: { raw_code: { const: 2 }, raw_name: { const: "ABSTOL_RESIDUAL" } } },
    { properties: { raw_code: { const: 3 }, raw_name: { const: "RELTOL_UPDATE" } } },
    { properties: { raw_code: { const: 4 }, raw_name: { const: "ABSTOL_UPDATE" } } },
  ],
} as const;
const legacyKinematicsExitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["raw_code", "raw_name"],
  properties: {
    raw_code: { anyOf: [{ type: "integer" }, { type: "null" }] },
    raw_name: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;
const requestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["request_id", "case_sha256"],
  properties: {
    request_id: requestIdSchema,
    case_sha256: sha256Schema,
    case_uri: caseUriSchema,
    timeout_ms: { type: "integer", minimum: 100, maximum: 60000 },
  },
} as const;
const bodyObservationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "position_m", "rotation_wxyz"],
  properties: {
    id: { type: "string" },
    position_m: vector3Schema,
    rotation_wxyz: quaternionSchema,
  },
} as const;
const motorObservationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "joint_id",
    "motor_angle_rad",
    "declared_limit_observation",
    "translation_residual_m",
    "rotation_quaternion_imag_residual",
  ],
  properties: {
    joint_id: { type: "string" },
    motor_angle_rad: { type: "number" },
    declared_limit_observation: { enum: ["below", "within", "above"] },
    translation_residual_m: vector3Schema,
    rotation_quaternion_imag_residual: vector3Schema,
  },
} as const;
const legacyMotorObservationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "joint_id",
    "declared_limit_observation",
    "translation_residual_m",
    "rotation_quaternion_imag_residual",
  ],
  properties: {
    joint_id: { type: "string" },
    motor_angle_rad: { type: "number" },
    declared_limit_observation: { enum: ["below", "within", "above"] },
    translation_residual_m: vector3Schema,
    rotation_quaternion_imag_residual: vector3Schema,
  },
} as const;
const sampleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["time_s", "bodies", "motors"],
  properties: {
    time_s: { type: "number" },
    bodies: { type: "array", items: bodyObservationSchema },
    motors: { type: "array", items: motorObservationSchema },
  },
} as const;
const legacySampleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["time_s", "bodies", "motors"],
  properties: {
    time_s: { type: "number" },
    bodies: { type: "array", items: bodyObservationSchema },
    motors: { type: "array", items: legacyMotorObservationSchema },
  },
} as const;
const observationSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "engine",
    "runtime",
    "execution_state",
    "kinematics_exit",
    "not_evaluated",
    "sample_count",
    "sample_time_range_s",
  ],
  properties: {
    engine: engineSchema,
    runtime: runtimeSchema,
    execution_state: { enum: ["completed", "not_converged"] },
    kinematics_exit: kinematicsExitSchema,
    not_evaluated: {
      const: [
        "collision",
        "clearance",
        "contact",
        "forces",
        "torques",
        "dynamics",
        "strength",
        "safety",
        "product fitness",
      ],
    },
    sample_count: { type: "integer", minimum: 1, maximum: 512 },
    sample_time_range_s: {
      type: "object",
      additionalProperties: false,
      required: ["first", "last"],
      properties: { first: { type: "number" }, last: { type: "number" } },
    },
  },
} as const;
const samplePageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["offset", "limit", "total", "returned", "has_more", "samples"],
  properties: {
    offset: { type: "integer", minimum: 0, maximum: 511 },
    limit: { type: "integer", minimum: 1, maximum: 64 },
    total: { type: "integer", minimum: 1, maximum: 512 },
    returned: { type: "integer", minimum: 0, maximum: 64 },
    has_more: { type: "boolean" },
    samples: { type: "array", maxItems: 64, items: sampleSchema },
  },
} as const;
const legacySamplePageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["offset", "limit", "total", "returned", "has_more", "samples"],
  properties: {
    offset: { type: "integer", minimum: 0, maximum: 511 },
    limit: { type: "integer", minimum: 1, maximum: 64 },
    total: { type: "integer", minimum: 1, maximum: 512 },
    returned: { type: "integer", minimum: 0, maximum: 64 },
    has_more: { type: "boolean" },
    samples: { type: "array", maxItems: 64, items: legacySampleSchema },
  },
} as const;
const receiptProperties = {
  schema_id: { const: RECEIPT_SCHEMA_ID },
  receipt_sha256: sha256Schema,
  case_sha256: sha256Schema,
  outcome_sha256: sha256Schema,
  request_id: requestIdSchema,
  recorded_at: { type: "string" },
  worker: {
    type: "object",
    additionalProperties: false,
    required: ["source_sha256"],
    properties: { source_sha256: sha256Schema },
  },
  runtime: runtimeSchema,
  execution_state: { enum: ["completed", "not_converged"] },
  kinematics_exit: kinematicsExitSchema,
} as const;
const receiptSchema = {
  oneOf: [{
    type: "object",
    additionalProperties: false,
    required: [
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
    ],
    properties: {
      package: {
        type: "object",
        additionalProperties: false,
        required: ["name", "version"],
        properties: {
          name: { const: "@casys/mcp-chrono" },
          version: { const: PROVIDER_VERSION },
        },
      },
      provider: {
        type: "object",
        additionalProperties: false,
        required: ["name", "version"],
        properties: {
          name: { const: "casys-chrono" },
          version: { const: PROVIDER_VERSION },
        },
      },
      ...receiptProperties,
      server_runtime: serverRuntimeSchema,
    },
  }, {
    type: "object",
    additionalProperties: false,
    required: [
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
    ],
    properties: {
      package: {
        type: "object",
        additionalProperties: false,
        required: ["name", "version"],
        properties: {
          name: { const: "@casys/mcp-chrono" },
          version: { const: "0.3.0" },
        },
      },
      provider: {
        type: "object",
        additionalProperties: false,
        required: ["name", "version"],
        properties: {
          name: { const: "casys-chrono" },
          version: { const: "0.3.0" },
        },
      },
      ...receiptProperties,
    },
  }],
} as const;
const recordViewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "request",
    "case_uri",
    "recorded_at",
    "receipt",
    "observation",
    "sample_page",
  ],
  properties: {
    request: requestSchema,
    case_uri: caseUriSchema,
    recorded_at: { type: "string" },
    receipt: receiptSchema,
    observation: observationSummarySchema,
    sample_page: samplePageSchema,
  },
} as const;
const legacyProvenanceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["persistence_format", "attestation", "receipt", "unavailable"],
  properties: {
    persistence_format: { const: "legacy-0.2" },
    attestation: { const: "unattested" },
    receipt: { const: "unavailable" },
    unavailable: {
      const: [
        "receipt_sha256",
        "outcome_sha256",
        "package",
        "provider",
        "worker",
        "runtime",
      ],
    },
  },
} as const;
const legacyObservationSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "engine",
    "execution_state",
    "kinematics_exit",
    "not_evaluated",
    "sample_count",
    "sample_time_range_s",
  ],
  properties: {
    engine: engineSchema,
    execution_state: { enum: ["completed", "not_converged"] },
    kinematics_exit: legacyKinematicsExitSchema,
    not_evaluated: {
      const: [
        "collision",
        "clearance",
        "contact",
        "forces",
        "torques",
        "dynamics",
        "strength",
        "safety",
        "product fitness",
      ],
    },
    sample_count: { type: "integer", minimum: 1, maximum: 512 },
    sample_time_range_s: {
      type: "object",
      additionalProperties: false,
      required: ["first", "last"],
      properties: { first: { type: "number" }, last: { type: "number" } },
    },
  },
} as const;
const legacyRecordViewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "request",
    "case_uri",
    "recorded_at",
    "provenance",
    "observation",
    "sample_page",
  ],
  properties: {
    request: requestSchema,
    case_uri: caseUriSchema,
    recorded_at: { type: "string" },
    provenance: legacyProvenanceSchema,
    observation: legacyObservationSummarySchema,
    sample_page: legacySamplePageSchema,
  },
} as const;
const recordReadViewSchema = {
  oneOf: [recordViewSchema, legacyRecordViewSchema],
} as const;
const intentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["request", "case_uri", "intent_recorded_at"],
  properties: {
    request: requestSchema,
    case_uri: caseUriSchema,
    intent_recorded_at: { type: "string" },
  },
} as const;

const manifestSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "version",
    "case_schema_id",
    "case_contract",
    "input_pose_semantics",
    "engine",
    "units",
    "frame",
    "authority",
    "submission",
    "result_paging",
    "receipt",
    "agent_workflow",
    "non_claims",
  ],
  properties: {
    name: { const: "@casys/mcp-chrono" },
    version: { const: PROVIDER_VERSION },
    case_schema_id: { const: CASE_SCHEMA_ID },
    case_contract: {
      type: "object",
      additionalProperties: false,
      required: ["json_schema", "example_case", "invariants"],
      properties: {
        json_schema: { const: CASE_JSON_SCHEMA },
        example_case: { const: CASE_TEMPLATE },
        invariants: { const: CASE_INVARIANTS },
      },
    },
    input_pose_semantics: { const: INPUT_POSE_SEMANTICS },
    engine: {
      type: "object",
      additionalProperties: false,
      required: ["name", "required_version"],
      properties: {
        name: { const: "Project Chrono" },
        required_version: { const: CHRONO_VERSION },
      },
    },
    units: { const: { length: "m", angle: "rad", time: "s" } },
    frame: { const: "right-handed" },
    authority: { const: "explicit mechanics input to factual observations only" },
    submission: { const: SUBMISSION_CONTRACT },
    result_paging: { const: RESULT_PAGING_CONTRACT },
    receipt: { const: RECEIPT_CONTRACT },
    agent_workflow: { const: AGENT_WORKFLOW },
    non_claims: { const: NON_CLAIMS },
  },
} as const;

export const manifestOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "manifest"],
  properties: { ok: { const: true }, manifest: manifestSchema },
} as const;

export const templateOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "case_schema_id", "example_case", "invariants"],
  properties: {
    ok: { const: true },
    case_schema_id: { const: CASE_SCHEMA_ID },
    example_case: { const: CASE_TEMPLATE },
    invariants: { const: CASE_INVARIANTS },
  },
} as const;

export const caseSubmitOutputSchema = {
  oneOf: [{
    type: "object",
    additionalProperties: false,
    required: ["ok", "case_sha256", "case_uri"],
    properties: {
      ok: { const: true },
      case_sha256: sha256Schema,
      case_uri: caseUriSchema,
    },
  }, failureSchema],
} as const;

export const caseGetOutputSchema = {
  oneOf: [{
    type: "object",
    additionalProperties: false,
    required: ["ok", "case_sha256", "case_uri", "case_json"],
    properties: {
      ok: { const: true },
      case_sha256: sha256Schema,
      case_uri: caseUriSchema,
      case_json: { type: "string", maxLength: 512 * 1024 },
    },
  }, failureSchema],
} as const;

export const runOutputSchema = {
  oneOf: [{
    type: "object",
    additionalProperties: false,
    required: ["ok", "replayed", "record"],
    properties: {
      ok: { const: true },
      replayed: { type: "boolean" },
      record: recordReadViewSchema,
    },
  }, failureSchema],
} as const;

export const runGetOutputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["ok", "state", "record"],
      properties: {
        ok: { const: true },
        state: { const: "recorded" },
        record: recordReadViewSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["ok", "state", "intent"],
      properties: {
        ok: { const: true },
        state: { const: "uncertain" },
        intent: intentSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["ok", "state"],
      properties: { ok: { const: true }, state: { const: "absent" } },
    },
    failureSchema,
  ],
} as const;

export const receiptGetOutputSchema = {
  oneOf: [{
    type: "object",
    additionalProperties: false,
    required: ["ok", "record"],
    properties: { ok: { const: true }, record: recordViewSchema },
  }, failureSchema],
} as const;
