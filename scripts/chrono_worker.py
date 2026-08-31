#!/usr/bin/env python3
"""Fixed Project Chrono 10.0.0 prescribed-kinematics worker."""
import json
import math
import platform
import sys

NOT_EVALUATED = ["collision", "clearance", "contact", "forces", "torques", "dynamics", "strength", "safety", "product fitness"]
REQUIRED_CHRONO_SYMBOLS = (
    "ChSystemNSC",
    "ChLinkMotorRotationAngle",
    "ChFunctionRamp",
    "ChFramed",
    "VNULL",
)
REQUIRED_MOTOR_METHODS = (
    "Initialize",
    "SetAngleFunction",
    "GetMotorAngle",
    "GetConstraintViolation",
)

RUNTIME = {
    "binding": "pychrono",
    "python_version": platform.python_version(),
}

# Chrono 10.0.0 declares AssemblyAnalysis::ExitFlag as this contiguous enum.
# Keep the native integer and its literal engine name together; an unexpected
# binding representation is an execution failure, never an invented result.
EXIT_FLAG_NAMES = {
    0: "NOT_CONVERGED",
    1: "SUCCESS",
    2: "ABSTOL_RESIDUAL",
    3: "RELTOL_UPDATE",
    4: "ABSTOL_UPDATE",
}


def vec3(values):
    return chrono.ChVector3d(values[0], values[1], values[2])


def quat(values):
    return chrono.ChQuaterniond(values[0], values[1], values[2], values[3])


def component(values, index):
    return float(values.GetItem(index))


def exit_details(flag):
    try:
        code = int(flag)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Project Chrono returned an unreadable kinematics exit flag") from exc
    try:
        name = EXIT_FLAG_NAMES[code]
    except KeyError as exc:
        raise RuntimeError("Project Chrono returned an unknown kinematics exit flag") from exc
    return {"raw_code": code, "raw_name": name}


def is_not_converged(details):
    return details["raw_name"] == "NOT_CONVERGED"


def planned_step_count(duration_s, step_s):
    # Admitted cases have a binary64 ratio of at most 10000. Underflow of
    # duration_s/step_s still needs one leftover step of remaining duration.
    return max(1, math.ceil(duration_s / step_s))


def next_kinematics_step_s(current_s, duration_s, step_s, last_planned=False):
    remaining = duration_s - current_s
    if remaining <= 0:
        return 0.0
    # The last planned index consumes the leftover remainder, even when it is
    # slightly larger than step_s. Interior indices never exceed step_s.
    if last_planned:
        return remaining
    return min(step_s, remaining)


def is_final_logical_step(step_index, planned_steps, current_s, duration_s, step_s):
    return step_index == planned_steps or next_kinematics_step_s(
        current_s, duration_s, step_s
    ) == 0.0


def should_store_sample(step_index, sample_every_steps, is_last):
    return is_last or step_index % sample_every_steps == 0


def require_chrono_runtime(chrono):
    missing_symbols = [name for name in REQUIRED_CHRONO_SYMBOLS if not hasattr(chrono, name)]
    motor_type = getattr(chrono, "ChLinkMotorRotationAngle", None)
    missing_motor_methods = [
        name for name in REQUIRED_MOTOR_METHODS if motor_type is None or not hasattr(motor_type, name)
    ]
    if missing_symbols or missing_motor_methods:
        missing = ", ".join(missing_symbols + missing_motor_methods)
        raise RuntimeError(f"PyChrono prescribed-kinematics API is unavailable: {missing}")


def main(case):
    global chrono
    import pychrono.core as chrono

    require_chrono_runtime(chrono)

    system = chrono.ChSystemNSC()
    system.SetGravitationalAcceleration(chrono.VNULL)
    bodies = {}
    for spec in case["bodies"]:
        body = chrono.ChBody()
        body.SetFixed(spec["fixed"])
        body.EnableCollision(False)
        body.SetPos(vec3(spec["absolute_com_pose"]["position_m"]))
        body.SetRot(quat(spec["absolute_com_pose"]["rotation_wxyz"]))
        system.AddBody(body)
        bodies[spec["id"]] = body

    motors = []
    for spec in case["joints"]:
        motor = chrono.ChLinkMotorRotationAngle()
        frame = chrono.ChFramed(
            vec3(spec["absolute_joint_frame"]["position_m"]),
            quat(spec["absolute_joint_frame"]["rotation_wxyz"]),
        )
        # Chrono measures the motor angle as frame1 relative to frame2. Keep
        # the submitted child as body1 and parent as body2 so positive +Z
        # rotation is the declared child-relative joint angle.
        motor.Initialize(bodies[spec["child_body"]], bodies[spec["parent_body"]], frame)
        motor.SetAngleFunction(
            chrono.ChFunctionRamp(
                spec["angle_ramp"]["initial_angle_rad"],
                spec["angle_ramp"]["angular_speed_rad_s"],
            )
        )
        # The motor itself is the only revolute constraint. Do not add a joint.
        system.AddLink(motor)
        motors.append((spec, motor))

    samples = []

    def collect():
        time_s = float(system.GetChTime())
        body_rows = []
        for spec in case["bodies"]:
            pos, rot = bodies[spec["id"]].GetPos(), bodies[spec["id"]].GetRot()
            body_rows.append({
                "id": spec["id"],
                "position_m": [float(pos.x), float(pos.y), float(pos.z)],
                "rotation_wxyz": [float(rot.e0), float(rot.e1), float(rot.e2), float(rot.e3)],
            })
        motor_rows = []
        for spec, motor in motors:
            violation = motor.GetConstraintViolation()
            angle = float(motor.GetMotorAngle())
            observed = angle
            lower, upper = spec["limits_rad"]
            relation = "below" if observed < lower else "above" if observed > upper else "within"
            row = {
                "joint_id": spec["id"],
                "declared_limit_observation": relation,
                # Never combine these heterogeneous constraint components.
                "translation_residual_m": [component(violation, 0), component(violation, 1), component(violation, 2)],
                "rotation_quaternion_imag_residual": [component(violation, 3), component(violation, 4), component(violation, 5)],
            }
            row["motor_angle_rad"] = angle
            motor_rows.append(row)
        samples.append({"time_s": time_s, "bodies": body_rows, "motors": motor_rows})

    # Submitted poses are zero-angle references. Apply initial motor angles during
    # assembly before exposing the observed t=0 sample.
    last_flag = system.DoStepKinematics(0.0)
    last_exit = exit_details(last_flag)
    collect()
    if is_not_converged(last_exit):
        return {
            "engine": {"name": "Project Chrono", "version": "10.0.0"},
            "runtime": RUNTIME,
            "samples": samples,
            "not_evaluated": NOT_EVALUATED,
            "execution_state": "not_converged",
            "kinematics_exit": last_exit,
        }

    duration_s = case["duration_s"]
    step_s = case["step_s"]
    sample_every_steps = case["sample_every_steps"]
    planned_steps = planned_step_count(duration_s, step_s)
    for step_index in range(1, planned_steps + 1):
        current = float(system.GetChTime())
        h = next_kinematics_step_s(
            current, duration_s, step_s, step_index == planned_steps
        )
        if h == 0.0:
            break
        last_flag = system.DoStepKinematics(h)
        last_exit = exit_details(last_flag)
        current = float(system.GetChTime())
        if is_not_converged(last_exit):
            if current > samples[-1]["time_s"]:
                collect()
            return {
                "engine": {"name": "Project Chrono", "version": "10.0.0"},
                "runtime": RUNTIME,
                "samples": samples,
                "not_evaluated": NOT_EVALUATED,
                "execution_state": "not_converged",
                "kinematics_exit": last_exit,
            }
        is_last = is_final_logical_step(
            step_index, planned_steps, current, duration_s, step_s
        )
        if should_store_sample(step_index, sample_every_steps, is_last):
            collect()
        if is_last and step_index != planned_steps:
            break

    return {
        "engine": {"name": "Project Chrono", "version": "10.0.0"},
        "runtime": RUNTIME,
        "samples": samples,
        "not_evaluated": NOT_EVALUATED,
        "execution_state": "completed",
        "kinematics_exit": last_exit,
    }


if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)
        print(json.dumps(main(payload), allow_nan=False, separators=(",", ":")))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
