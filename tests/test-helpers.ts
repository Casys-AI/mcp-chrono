import type {
  PrescribedKinematicsCase,
  RunExecution,
  RunObservation,
} from "../src/domain/types.ts";

export const caseData = (): PrescribedKinematicsCase => ({
  schema_id: "chrono-prescribed-kinematics-case/1.0",
  units: { length: "m", angle: "rad", time: "s" },
  frame: { handedness: "right" },
  bodies: [{
    id: "root",
    fixed: true,
    absolute_com_pose: { position_m: [0, 0, 0], rotation_wxyz: [1, 0, 0, 0] },
  }],
  joints: [],
  duration_s: 1,
  step_s: 0.1,
  sample_every_steps: 1,
});
export const oneJointCase = (): PrescribedKinematicsCase => ({
  schema_id: "chrono-prescribed-kinematics-case/1.0",
  units: { length: "m", angle: "rad", time: "s" },
  frame: { handedness: "right" },
  bodies: [
    {
      id: "root",
      fixed: true,
      absolute_com_pose: { position_m: [0, 0, 0], rotation_wxyz: [1, 0, 0, 0] },
    },
    {
      id: "arm",
      fixed: false,
      absolute_com_pose: { position_m: [0, 0, 1], rotation_wxyz: [1, 0, 0, 0] },
    },
  ],
  joints: [{
    id: "hinge",
    parent_body: "root",
    child_body: "arm",
    absolute_joint_frame: { position_m: [0, 0, 0], rotation_wxyz: [1, 0, 0, 0] },
    angle_ramp: { initial_angle_rad: 0, angular_speed_rad_s: 0.5 },
    limits_rad: [-1, 1],
  }],
  duration_s: 1,
  step_s: 0.1,
  sample_every_steps: 1,
});
export const observation = (sampleCount = 2): RunObservation => ({
  engine: { name: "Project Chrono", version: "10.0.0" },
  runtime: { binding: "pychrono", python_version: "3.12.0" },
  samples: Array.from({ length: sampleCount }, (_, index) => ({
    time_s: sampleCount === 1 ? 0 : index / (sampleCount - 1),
    bodies: [{
      id: "root",
      position_m: [0, 0, 0],
      rotation_wxyz: [1, 0, 0, 0],
    }],
    motors: [],
  })),
  not_evaluated: [
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
  execution_state: "completed",
  kinematics_exit: { raw_code: 1, raw_name: "SUCCESS" },
});
export const workerObservation = (
  input: PrescribedKinematicsCase,
): Record<string, unknown> => ({
  engine: { name: "Project Chrono", version: "10.0.0" },
  runtime: { binding: "pychrono", python_version: "3.12.0" },
  samples: [0, input.duration_s].map((time_s) => ({
    time_s,
    bodies: input.bodies.map((body) => ({
      id: body.id,
      position_m: [...body.absolute_com_pose.position_m],
      rotation_wxyz: [...body.absolute_com_pose.rotation_wxyz],
    })),
    motors: input.joints.map((joint) => ({
      joint_id: joint.id,
      declared_limit_observation: "within",
      translation_residual_m: [0, 0, 0],
      rotation_quaternion_imag_residual: [0, 0, 0],
      motor_angle_rad: joint.angle_ramp.initial_angle_rad +
        joint.angle_ramp.angular_speed_rad_s * time_s,
    })),
  })),
  not_evaluated: [
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
  execution_state: "completed",
  kinematics_exit: { raw_code: 1, raw_name: "SUCCESS" },
});
export class FakeRunner {
  calls = 0;
  constructor(private readonly output: RunObservation = observation()) {}
  run(): Promise<RunExecution> {
    this.calls++;
    return Promise.resolve({
      observation: this.output,
      worker: { source_sha256: "f".repeat(64) },
    });
  }
}
