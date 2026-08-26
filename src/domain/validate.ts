import { ChronoError } from "./errors.ts";
import {
  CASE_SCHEMA_ID,
  type ChronoBody,
  type ChronoJoint,
  type Pose,
  type PrescribedKinematicsCase,
  type Quat,
  type Vec3,
} from "./types.ts";

const MAX_ABS = 1_000_000;
const object = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChronoError("case_invalid", `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
};
const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ChronoError("case_invalid", `${path} has unsupported property ${key}.`);
    }
  }
  for (const key of allowed) {
    if (!(key in value)) {
      throw new ChronoError("case_invalid", `${path}.${key} is required.`);
    }
  }
};
const finite = (value: unknown, path: string): number => {
  if (
    typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_ABS
  ) {
    throw new ChronoError(
      "case_invalid",
      `${path} must be a finite, reasonable number.`,
    );
  }
  return value;
};
const stringId = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new ChronoError("case_invalid", `${path} must be a safe identifier.`);
  }
  return value;
};
function vec3(value: unknown, path: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ChronoError(
      "case_invalid",
      `${path} must contain exactly three numbers.`,
    );
  }
  return [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
  ];
}
function quat(value: unknown, path: string): Quat {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new ChronoError("case_invalid", `${path} must contain exactly four numbers.`);
  }
  const result: Quat = [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
    finite(value[3], `${path}[3]`),
  ];
  const norm = Math.hypot(...result);
  if (Math.abs(norm - 1) > 1e-8) {
    throw new ChronoError("case_invalid", `${path} must be normalized.`);
  }
  return result;
}
function pose(value: unknown, path: string): Pose {
  const raw = object(value, path);
  exactKeys(raw, ["position_m", "rotation_wxyz"], path);
  return {
    position_m: vec3(raw.position_m, `${path}.position_m`),
    rotation_wxyz: quat(raw.rotation_wxyz, `${path}.rotation_wxyz`),
  };
}
function body(value: unknown, index: number): ChronoBody {
  const path = `bodies[${index}]`;
  const raw = object(value, path);
  exactKeys(raw, ["id", "fixed", "absolute_com_pose"], path);
  if (typeof raw.fixed !== "boolean") {
    throw new ChronoError("case_invalid", `${path}.fixed must be boolean.`);
  }
  return {
    id: stringId(raw.id, `${path}.id`),
    fixed: raw.fixed,
    absolute_com_pose: pose(raw.absolute_com_pose, `${path}.absolute_com_pose`),
  };
}
function joint(value: unknown, index: number): ChronoJoint {
  const path = `joints[${index}]`;
  const raw = object(value, path);
  exactKeys(raw, [
    "id",
    "parent_body",
    "child_body",
    "absolute_joint_frame",
    "angle_ramp",
    "limits_rad",
  ], path);
  const ramp = object(raw.angle_ramp, `${path}.angle_ramp`);
  exactKeys(ramp, ["initial_angle_rad", "angular_speed_rad_s"], `${path}.angle_ramp`);
  if (!Array.isArray(raw.limits_rad) || raw.limits_rad.length !== 2) {
    throw new ChronoError("case_invalid", `${path}.limits_rad must have two values.`);
  }
  const limits: [number, number] = [
    finite(raw.limits_rad[0], `${path}.limits_rad[0]`),
    finite(raw.limits_rad[1], `${path}.limits_rad[1]`),
  ];
  if (limits[0] > limits[1]) {
    throw new ChronoError(
      "case_invalid",
      `${path}.limits_rad min must not exceed max.`,
    );
  }
  return {
    id: stringId(raw.id, `${path}.id`),
    parent_body: stringId(raw.parent_body, `${path}.parent_body`),
    child_body: stringId(raw.child_body, `${path}.child_body`),
    absolute_joint_frame: pose(
      raw.absolute_joint_frame,
      `${path}.absolute_joint_frame`,
    ),
    angle_ramp: {
      initial_angle_rad: finite(
        ramp.initial_angle_rad,
        `${path}.angle_ramp.initial_angle_rad`,
      ),
      angular_speed_rad_s: finite(
        ramp.angular_speed_rad_s,
        `${path}.angle_ramp.angular_speed_rad_s`,
      ),
    },
    limits_rad: limits,
  };
}
export function validateCase(value: unknown): PrescribedKinematicsCase {
  const raw = object(value, "case");
  exactKeys(raw, [
    "schema_id",
    "units",
    "frame",
    "bodies",
    "joints",
    "duration_s",
    "step_s",
    "sample_every_steps",
  ], "case");
  if (raw.schema_id !== CASE_SCHEMA_ID) {
    throw new ChronoError("case_invalid", `case.schema_id must be ${CASE_SCHEMA_ID}.`);
  }
  const units = object(raw.units, "case.units");
  exactKeys(units, ["length", "angle", "time"], "case.units");
  if (units.length !== "m" || units.angle !== "rad" || units.time !== "s") {
    throw new ChronoError("case_invalid", "case.units is fixed to m/rad/s.");
  }
  const frame = object(raw.frame, "case.frame");
  exactKeys(frame, ["handedness"], "case.frame");
  if (frame.handedness !== "right") {
    throw new ChronoError("case_invalid", "case.frame.handedness must be right.");
  }
  if (!Array.isArray(raw.bodies) || raw.bodies.length < 1 || raw.bodies.length > 16) {
    throw new ChronoError("case_invalid", "case.bodies must contain 1 to 16 bodies.");
  }
  const bodies = raw.bodies.map(body);
  const bodyIds = new Set(bodies.map((b) => b.id));
  if (bodyIds.size !== bodies.length) {
    throw new ChronoError("case_invalid", "Body ids must be unique.");
  }
  const roots = bodies.filter((b) => b.fixed);
  if (roots.length !== 1) {
    throw new ChronoError("case_invalid", "Exactly one fixed root is required.");
  }
  if (
    !Array.isArray(raw.joints) || raw.joints.length !== bodies.length - 1 ||
    raw.joints.length > 15
  ) {
    throw new ChronoError(
      "case_invalid",
      "Joints must form a tree with one edge for every non-root body.",
    );
  }
  const joints = raw.joints.map(joint);
  const jointIds = new Set(joints.map((j) => j.id));
  if (jointIds.size !== joints.length) {
    throw new ChronoError("case_invalid", "Joint ids must be unique.");
  }
  const root = roots[0].id;
  const children = new Set<string>();
  const parentByChild = new Map<string, string>();
  for (const j of joints) {
    if (
      !bodyIds.has(j.parent_body) || !bodyIds.has(j.child_body) ||
      j.parent_body === j.child_body
    ) {
      throw new ChronoError(
        "case_invalid",
        `Joint ${j.id} must connect two distinct declared bodies.`,
      );
    }
    if (j.child_body === root || children.has(j.child_body)) {
      throw new ChronoError(
        "case_invalid",
        "Every non-root body must appear exactly once as a joint child.",
      );
    }
    children.add(j.child_body);
    parentByChild.set(j.child_body, j.parent_body);
  }
  for (const b of bodies) {
    if (b.id !== root && !children.has(b.id)) {
      throw new ChronoError(
        "case_invalid",
        "Every non-root body must appear exactly once as a joint child.",
      );
    }
  }
  for (const b of bodies) {
    const seen = new Set<string>();
    let current = b.id;
    while (current !== root) {
      if (seen.has(current) || !parentByChild.has(current)) {
        throw new ChronoError(
          "case_invalid",
          "Joints must be one connected acyclic tree.",
        );
      }
      seen.add(current);
      current = parentByChild.get(current)!;
    }
  }
  const duration_s = finite(raw.duration_s, "case.duration_s");
  const step_s = finite(raw.step_s, "case.step_s");
  if (
    !(duration_s > 0 && duration_s <= 10) || !(step_s > 0) ||
    duration_s / step_s > 10_000
  ) {
    throw new ChronoError(
      "case_invalid",
      "duration_s/step_s is outside supported bounds.",
    );
  }
  if (
    !Number.isSafeInteger(raw.sample_every_steps) ||
    (raw.sample_every_steps as number) < 1
  ) {
    throw new ChronoError(
      "case_invalid",
      "sample_every_steps must be a positive integer.",
    );
  }
  if (Math.floor(duration_s / step_s) / (raw.sample_every_steps as number) + 2 > 512) {
    throw new ChronoError("case_invalid", "Requested returned samples exceed 512.");
  }
  return {
    schema_id: CASE_SCHEMA_ID,
    units: { length: "m", angle: "rad", time: "s" },
    frame: { handedness: "right" },
    bodies,
    joints,
    duration_s,
    step_s,
    sample_every_steps: raw.sample_every_steps as number,
  };
}
