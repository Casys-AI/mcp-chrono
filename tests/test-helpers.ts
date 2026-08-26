import type { PrescribedKinematicsCase, RunObservation } from "../src/domain/types.ts";

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
export const observation = (): RunObservation => ({
  engine: { name: "Project Chrono", version: "10.0.0" },
  samples: [0, 1].map((time_s) => ({
    time_s,
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
  kinematics_exit: { raw_code: 0, raw_name: "OK" },
});
export const workerObservation = (
  input: PrescribedKinematicsCase,
): Record<string, unknown> => ({
  engine: { name: "Project Chrono", version: "10.0.0" },
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
  kinematics_exit: { raw_code: 0, raw_name: "OK" },
});
export class FakeRunner {
  calls = 0;
  run(): Promise<RunObservation> {
    this.calls++;
    return Promise.resolve(observation());
  }
}
