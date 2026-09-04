export const CASE_SCHEMA_ID = "chrono-prescribed-kinematics-case/1.0" as const;
export const RECEIPT_SCHEMA_ID = "chrono-prescribed-kinematics-receipt/1.0" as const;
export const CHRONO_VERSION = "10.0.0" as const;
export const PROVIDER_VERSION = "0.3.4" as const;

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export interface Pose {
  position_m: Vec3;
  rotation_wxyz: Quat;
}
export interface ChronoBody {
  id: string;
  fixed: boolean;
  absolute_com_pose: Pose;
}
export interface AngleRamp {
  initial_angle_rad: number;
  angular_speed_rad_s: number;
}
export interface ChronoJoint {
  id: string;
  parent_body: string;
  child_body: string;
  absolute_joint_frame: Pose;
  angle_ramp: AngleRamp;
  limits_rad: readonly [number, number];
}
export interface PrescribedKinematicsCase {
  schema_id: typeof CASE_SCHEMA_ID;
  units: { length: "m"; angle: "rad"; time: "s" };
  frame: { handedness: "right" };
  bodies: ChronoBody[];
  joints: ChronoJoint[];
  duration_s: number;
  step_s: number;
  sample_every_steps: number;
}

export interface RunRequest {
  request_id: string;
  case_sha256: string;
  case_uri?: string;
  timeout_ms?: number;
}
export interface MotorObservation {
  joint_id: string;
  motor_angle_rad: number;
  declared_limit_observation: "below" | "within" | "above";
  translation_residual_m: [number, number, number];
  rotation_quaternion_imag_residual: [number, number, number];
}
export interface BodyObservation {
  id: string;
  position_m: [number, number, number];
  rotation_wxyz: [number, number, number, number];
}
export interface KinematicsSample {
  time_s: number;
  bodies: BodyObservation[];
  motors: MotorObservation[];
}
export interface RunObservation {
  engine: { name: "Project Chrono"; version: typeof CHRONO_VERSION };
  runtime: { binding: "pychrono"; python_version: string };
  samples: KinematicsSample[];
  not_evaluated: readonly [
    "collision",
    "clearance",
    "contact",
    "forces",
    "torques",
    "dynamics",
    "strength",
    "safety",
    "product fitness",
  ];
  execution_state: "completed" | "not_converged";
  kinematics_exit: { raw_code: number; raw_name: string };
}
export interface WorkerIdentity {
  source_sha256: string;
}
export interface ServerRuntimeIdentity {
  deno_version: string;
}
export interface RunExecution {
  observation: RunObservation;
  worker: WorkerIdentity;
}
export interface RunReceipt {
  schema_id: typeof RECEIPT_SCHEMA_ID;
  receipt_sha256: string;
  case_sha256: string;
  outcome_sha256: string;
  request_id: string;
  recorded_at: string;
  package: {
    name: "@casys/mcp-chrono";
    version: typeof PROVIDER_VERSION;
  };
  provider: {
    name: "casys-chrono";
    version: typeof PROVIDER_VERSION;
  };
  worker: WorkerIdentity;
  runtime: RunObservation["runtime"];
  server_runtime: ServerRuntimeIdentity;
  execution_state: RunObservation["execution_state"];
  kinematics_exit: RunObservation["kinematics_exit"];
}
export interface RunRecord {
  request: RunRequest;
  case_uri: string;
  recorded_at: string;
  output: RunObservation;
  receipt: RunReceipt;
}
export interface RunObservationSummary {
  engine: { name: "Project Chrono"; version: typeof CHRONO_VERSION };
  runtime: RunObservation["runtime"];
  execution_state: "completed" | "not_converged";
  kinematics_exit: { raw_code: number; raw_name: string };
  not_evaluated: RunObservation["not_evaluated"];
  sample_count: number;
  sample_time_range_s: { first: number; last: number };
}
export interface SamplePage {
  offset: number;
  limit: number;
  total: number;
  returned: number;
  has_more: boolean;
  samples: KinematicsSample[];
}
export interface AttestedRunRecordView {
  request: RunRequest;
  case_uri: string;
  recorded_at: string;
  receipt: RunReceipt;
  observation: RunObservationSummary;
  sample_page: SamplePage;
}
export type RunRecordView = AttestedRunRecordView;
export interface RunIntent {
  request: RunRequest;
  case_uri: string;
  intent_recorded_at: string;
}
export type RunLookup = { state: "recorded"; record: RunRecord } | {
  state: "uncertain";
  intent: RunIntent;
} | { state: "absent" };
export type RunLookupView = { state: "recorded"; record: RunRecordView } | {
  state: "uncertain";
  intent: RunIntent;
} | { state: "absent" };
