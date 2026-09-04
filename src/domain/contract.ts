import { CASE_SCHEMA_ID, type PrescribedKinematicsCase } from "./types.ts";

/** Exact UTF-8 byte ceiling enforced again by the application service. */
export const MAX_CASE_JSON_BYTES = 512 * 1024;
/** Default bounded result page returned by run and readback calls. */
export const DEFAULT_SAMPLE_PAGE_LIMIT = 16;
/** Largest result page an MCP caller can request. */
export const MAX_SAMPLE_PAGE_LIMIT = 64;
/** There can never be more than 512 samples in a persisted 1.0 observation. */
export const MAX_SAMPLE_PAGE_OFFSET = 511;

/**
 * A valid, non-executing example. Callers must serialize their own exact UTF-8
 * JSON before submitting it; the server never mutates this case for them.
 */
export const CASE_TEMPLATE: PrescribedKinematicsCase = {
  schema_id: CASE_SCHEMA_ID,
  units: { length: "m", angle: "rad", time: "s" },
  frame: { handedness: "right" },
  bodies: [
    {
      id: "root",
      fixed: true,
      absolute_com_pose: {
        position_m: [0, 0, 0],
        rotation_wxyz: [1, 0, 0, 0],
      },
    },
    {
      id: "arm",
      fixed: false,
      absolute_com_pose: {
        position_m: [1, 0, 0],
        rotation_wxyz: [1, 0, 0, 0],
      },
    },
  ],
  joints: [{
    id: "hinge",
    parent_body: "root",
    child_body: "arm",
    absolute_joint_frame: {
      position_m: [0, 0, 0],
      rotation_wxyz: [1, 0, 0, 0],
    },
    angle_ramp: { initial_angle_rad: 0, angular_speed_rad_s: 0.5 },
    limits_rad: [-1, 1],
  }],
  duration_s: 1,
  step_s: 0.1,
  sample_every_steps: 1,
};

/**
 * Complete structural JSON Schema for the 1.0 case. The tree and numerical
 * cross-field rules below remain server-validated invariants because JSON
 * Schema cannot express them faithfully.
 */
export const CASE_JSON_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": CASE_SCHEMA_ID,
  title: "Chrono prescribed kinematics case",
  description:
    "Closed explicit Project Chrono prescribed rigid-body kinematics case. Every object rejects unspecified properties.",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_id",
    "units",
    "frame",
    "bodies",
    "joints",
    "duration_s",
    "step_s",
    "sample_every_steps",
  ],
  properties: {
    schema_id: { const: CASE_SCHEMA_ID },
    units: {
      const: { length: "m", angle: "rad", time: "s" },
      description: "SI units are fixed and must be literal m/rad/s.",
    },
    frame: {
      const: { handedness: "right" },
      description: "The global frame is fixed to right-handed coordinates.",
    },
    bodies: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: { "$ref": "#/$defs/body" },
    },
    joints: {
      type: "array",
      minItems: 0,
      maxItems: 15,
      items: { "$ref": "#/$defs/revoluteAngleMotor" },
    },
    duration_s: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 10,
      description: "Requested kinematic duration in seconds.",
    },
    step_s: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 1000000,
      description: "Positive kinematic integration step in seconds.",
    },
    sample_every_steps: {
      type: "integer",
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
      description: "Emit one stored observation after this many integration steps.",
    },
  },
  "$defs": {
    identifier: {
      type: "string",
      pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
    },
    finiteNumber: { type: "number", minimum: -1000000, maximum: 1000000 },
    vector3: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { "$ref": "#/$defs/finiteNumber" },
    },
    quaternionWxyz: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { "$ref": "#/$defs/finiteNumber" },
      description: "Normalized quaternion in [w, x, y, z] order.",
    },
    absolutePose: {
      type: "object",
      additionalProperties: false,
      required: ["position_m", "rotation_wxyz"],
      properties: {
        position_m: { "$ref": "#/$defs/vector3" },
        rotation_wxyz: { "$ref": "#/$defs/quaternionWxyz" },
      },
    },
    body: {
      type: "object",
      additionalProperties: false,
      required: ["id", "fixed", "absolute_com_pose"],
      properties: {
        id: { "$ref": "#/$defs/identifier" },
        fixed: { type: "boolean" },
        absolute_com_pose: {
          "$ref": "#/$defs/absolutePose",
          description:
            "Absolute centre-of-mass pose at zero motor angle, not necessarily the observed t=0 pose.",
        },
      },
    },
    angleRamp: {
      type: "object",
      additionalProperties: false,
      required: ["initial_angle_rad", "angular_speed_rad_s"],
      properties: {
        initial_angle_rad: { "$ref": "#/$defs/finiteNumber" },
        angular_speed_rad_s: { "$ref": "#/$defs/finiteNumber" },
      },
      description: "The only 1.0 motion profile: angle(t) = initial + speed * t.",
    },
    revoluteAngleMotor: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "parent_body",
        "child_body",
        "absolute_joint_frame",
        "angle_ramp",
        "limits_rad",
      ],
      properties: {
        id: { "$ref": "#/$defs/identifier" },
        parent_body: { "$ref": "#/$defs/identifier" },
        child_body: { "$ref": "#/$defs/identifier" },
        absolute_joint_frame: {
          "$ref": "#/$defs/absolutePose",
          description:
            "Absolute zero-angle joint frame; its local +Z is the positive child-relative rotation axis.",
        },
        angle_ramp: { "$ref": "#/$defs/angleRamp" },
        limits_rad: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: { "$ref": "#/$defs/finiteNumber" },
          description:
            "Declared [lower, upper] angular range in rad. It is observed, not enforced as a physical stop.",
        },
      },
    },
  },
  examples: [CASE_TEMPLATE],
} as const;

/** Rules that are intentionally enforced by the server after JSON Schema validation. */
export const CASE_INVARIANTS = [
  {
    id: "closed-object-shapes",
    requirement:
      "Every object has exactly the declared properties; unknown fields fail.",
  },
  {
    id: "normalized-quaternions",
    requirement: "Every rotation_wxyz must have norm 1 within 1e-8.",
  },
  {
    id: "single-fixed-root",
    requirement: "Exactly one body is fixed.",
  },
  {
    id: "unique-identities",
    requirement: "Body ids are unique and joint ids are unique within the case.",
  },
  {
    id: "connected-acyclic-tree",
    requirement:
      "Joints are a connected acyclic tree: exactly one parent per non-root body and body_count - 1 joints.",
  },
  {
    id: "joint-frame-semantics",
    requirement:
      "The submitted joint frame is an absolute zero-angle reference and local +Z is the positive rotation axis.",
  },
  {
    id: "initial-angle-semantics",
    requirement:
      "The worker applies initial_angle_rad during assembly, so observed t=0 may differ from submitted zero-angle poses.",
  },
  {
    id: "sample-bound",
    requirement:
      "duration_s / step_s is at most 10000 and the requested stored observation count is at most 512.",
  },
  {
    id: "declared-limit-observation",
    requirement:
      "limits_rad lower must not exceed upper; it only classifies the observed motor angle and never creates a stop, contact or force.",
  },
] as const;

export const AGENT_WORKFLOW = [
  "Read chrono_manifest_get before constructing a case.",
  "Start from chrono_case_template_get or manifest.case_contract.example_case; fill every explicit pose, joint frame and SI value yourself.",
  "Serialize the final case as exact UTF-8 JSON and call chrono_case_submit. case_sha256 is optional; if supplied it is an expected digest and a mismatch fails without storage.",
  "Call chrono_run_prescribed_kinematics with the returned case_sha256 and a fresh request_id. Reuse a recorded request_id only for the same case.",
  "Use chrono_case_get with case_sha256 when another client must recover the exact submitted UTF-8 bytes.",
  "Read records with chrono_run_get, or chrono_run_receipt_get with a recorded canonical receipt_sha256. This development source reads only its exact 0.3.4 receipt identity; another persisted version is unsupported/corrupt and is never rewritten or relabelled. Both read paths return an observation summary plus a bounded sample page; advance sample_offset until has_more is false.",
] as const;

export const INPUT_POSE_SEMANTICS =
  "absolute_com_pose and absolute_joint_frame are absolute zero-angle references; t=0 is observed after assembly applies initial_angle_rad and may differ." as const;

export const SUBMISSION_CONTRACT = {
  case_json: `Exact UTF-8 JSON string, at most ${MAX_CASE_JSON_BYTES} bytes (512 KiB).`,
  case_sha256:
    "Optional expected SHA-256. The server always computes and returns case_sha256; a supplied mismatch fails without storing the case and includes actual_case_sha256 in error details.",
} as const;

export const RESULT_PAGING_CONTRACT = {
  default_sample_limit: DEFAULT_SAMPLE_PAGE_LIMIT,
  maximum_sample_limit: MAX_SAMPLE_PAGE_LIMIT,
  maximum_sample_offset: MAX_SAMPLE_PAGE_OFFSET,
  contract:
    "Recorded observations remain complete in the durable ledger. MCP run/readback responses contain a summary and one bounded sample_page only.",
} as const;

export const RECEIPT_CONTRACT = {
  schema_id: "chrono-prescribed-kinematics-receipt/1.0",
  contract:
    "Every recorded run has a canonical receipt SHA-256 over its case identity, outcome SHA-256, request identity, recorded timestamp, package/provider/worker/PyChrono runtime/server Deno runtime identities and literal execution state. The receipt is factual provenance, never a product verdict. This development source reads only its exact 0.3.4 receipt identity; another persisted version is unsupported/corrupt and is never rewritten or relabelled.",
} as const;

export const NON_CLAIMS = [
  "joint inference",
  "axis inference",
  "frame inference",
  "unit inference",
  "STEP interpretation",
  "collision",
  "clearance",
  "contact",
  "forces",
  "torques",
  "dynamics",
  "strength",
  "safety",
  "product pass/fail",
] as const;
