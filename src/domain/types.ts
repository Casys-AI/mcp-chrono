export const CASE_SCHEMA_ID = "chrono-prescribed-kinematics-case/1.0" as const;
export const CHRONO_VERSION = "10.0.0" as const;
export const PROVIDER_VERSION = "0.2.0" as const;

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
  motor_angle_rad?: number;
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
  kinematics_exit: { raw_code: number | null; raw_name: string | null };
}
export interface RunRecord {
  request: RunRequest;
  case_uri: string;
  recorded_at: string;
  output: RunObservation;
}
export interface RunObservationSummary {
  engine: { name: "Project Chrono"; version: typeof CHRONO_VERSION };
  execution_state: "completed" | "not_converged";
  kinematics_exit: { raw_code: number | null; raw_name: string | null };
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
export interface RunRecordView {
  request: RunRequest;
  case_uri: string;
  recorded_at: string;
  observation: RunObservationSummary;
  sample_page: SamplePage;
}
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
