"""Focused tests for the prescribed-kinematics planned-step sampling loop."""

from __future__ import annotations

from contextlib import contextmanager
import importlib.util
import math
from pathlib import Path
import sys
import types
import unittest


WORKER = Path(__file__).parents[1] / "scripts" / "chrono_worker.py"
SPEC = importlib.util.spec_from_file_location("chrono_worker", WORKER)
assert SPEC is not None and SPEC.loader is not None
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)

# IEEE-754 evidence of the live 0.3.1 defect: ten additions of 0.1 land one
# ulp short of 1.0. A time-closeness terminator either takes a leftover
# epsilon step or relabels an interior tick. The planned-step loop closes
# that leftover on the last planned index and publishes the engine clock.
LIVE_DURATION_S = 1.0
LIVE_STEP_S = 0.1
LIVE_ENGINE_TERMINAL = 0.9999999999999999
# validate.ts admits duration_s > 0 and duration_s / step_s <= 10000.
TINY_DURATION_S = 1e-12
TINY_STEP_S = 1e-13
# Positive subnormals are admitted. 400 * min subnormal is an exact ratio.
# A 2-ULP closeness rule would stop two ticks early and relabel 398 * step
# as duration.
SUBNORMAL_STEP_S = math.ulp(0.0)
SUBNORMAL_DURATION_S = float.fromhex("0x0.0000000000190p-1022")
# 10,000 additions of 0.0001 stay farther than 2 ULP from 1.0, so a
# closeness cap still takes an epsilon 10,001st step.
FINE_DURATION_S = 1.0
FINE_STEP_S = 0.0001
FINE_ENGINE_TERMINAL = 0.9999999999999062
FINE_SAMPLE_EVERY_STEPS = 20


def replay_sample_times(duration_s, step_s, sample_every_steps=1):
    """Replay the worker time loop with Python float accumulation."""
    current = 0.0
    planned_steps = worker.planned_step_count(duration_s, step_s)
    times = [float(current)]
    engine_times = [current]
    for step_index in range(1, planned_steps + 1):
        h = worker.next_kinematics_step_s(
            current, duration_s, step_s, step_index == planned_steps
        )
        if h == 0.0:
            break
        current += h
        engine_times.append(current)
        is_last = worker.is_final_logical_step(
            step_index, planned_steps, current, duration_s, step_s
        )
        if worker.should_store_sample(step_index, sample_every_steps, is_last):
            times.append(float(current))
        if is_last and step_index != planned_steps:
            break
    return engine_times, times


class ChronoWorkerTerminalSamplingTests(unittest.TestCase):
    def test_planned_step_count_matches_admitted_ratios(self):
        self.assertEqual(worker.planned_step_count(LIVE_DURATION_S, LIVE_STEP_S), 10)
        self.assertEqual(worker.planned_step_count(1.0, 0.3), 4)
        self.assertEqual(worker.planned_step_count(TINY_DURATION_S, TINY_STEP_S), 10)
        self.assertEqual(
            worker.planned_step_count(SUBNORMAL_DURATION_S, SUBNORMAL_STEP_S),
            400,
        )
        self.assertEqual(worker.planned_step_count(FINE_DURATION_S, FINE_STEP_S), 10_000)
        self.assertEqual(worker.planned_step_count(0.07, 0.01), 8)
        self.assertEqual(SUBNORMAL_STEP_S / 10.0, 0.0)
        self.assertEqual(worker.planned_step_count(SUBNORMAL_STEP_S, 10.0), 1)

    def test_live_one_tenth_case_collects_eleven_engine_ticks(self):
        drifted = 0.0
        for _ in range(10):
            drifted += LIVE_STEP_S
        self.assertEqual(drifted, LIVE_ENGINE_TERMINAL)
        self.assertLess(drifted, LIVE_DURATION_S)
        after_nine = 0.0
        for _ in range(9):
            after_nine += LIVE_STEP_S
        self.assertEqual(after_nine, 0.8999999999999999)
        leftover = LIVE_DURATION_S - after_nine
        self.assertGreater(leftover, LIVE_STEP_S)
        self.assertEqual(
            worker.next_kinematics_step_s(
                after_nine, LIVE_DURATION_S, LIVE_STEP_S, False
            ),
            LIVE_STEP_S,
        )
        self.assertEqual(
            worker.next_kinematics_step_s(
                after_nine, LIVE_DURATION_S, LIVE_STEP_S, True
            ),
            leftover,
        )
        self.assertEqual(after_nine + leftover, LIVE_DURATION_S)

        engine_times, times = replay_sample_times(LIVE_DURATION_S, LIVE_STEP_S)
        self.assertEqual(len(engine_times) - 1, 10)
        self.assertEqual(len(times), 11)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], engine_times[-1])
        self.assertEqual(engine_times[-1], LIVE_DURATION_S)
        self.assertEqual(times.count(engine_times[-1]), 1)
        self.assertNotIn(LIVE_ENGINE_TERMINAL, engine_times)
        self.assertNotIn(LIVE_ENGINE_TERMINAL, times)
        self.assertEqual(times[9], 0.8999999999999999)
        self.assertEqual(len(times), len(set(times)))
        self.assertEqual(times, sorted(times))

    def test_non_dividing_duration_records_four_motor_steps(self):
        engine_times, times = replay_sample_times(1.0, 0.3)
        self.assertEqual(len(engine_times) - 1, 4)
        self.assertEqual(len(times), 5)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[1], 0.3)
        self.assertEqual(times[2], 0.6)
        self.assertEqual(times[3], 0.8999999999999999)
        self.assertEqual(times[-1], engine_times[-1])
        self.assertEqual(engine_times[-1], 1.0)
        self.assertEqual(times.count(engine_times[-1]), 1)
        self.assertEqual(
            worker.next_kinematics_step_s(0.8999999999999999, 1.0, 0.3, True),
            1.0 - 0.8999999999999999,
        )
        self.assertEqual(
            worker.next_kinematics_step_s(0.8999999999999999, 1.0, 0.3, False),
            1.0 - 0.8999999999999999,
        )

    def test_tiny_valid_ratio_collects_eleven_ticks_without_swallowing_interiors(self):
        expected = [0.0]
        current = 0.0
        for _ in range(9):
            current += TINY_STEP_S
            expected.append(current)
        leftover = TINY_DURATION_S - current
        expected.append(current + leftover)
        self.assertEqual(len(expected), 11)
        self.assertEqual(expected[-1], TINY_DURATION_S)
        self.assertNotEqual(expected[1], TINY_DURATION_S)

        engine_times, times = replay_sample_times(TINY_DURATION_S, TINY_STEP_S)
        self.assertEqual(len(engine_times) - 1, 10)
        self.assertEqual(len(times), 11)
        self.assertEqual(engine_times, expected)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], engine_times[-1])
        self.assertEqual(engine_times[-1], TINY_DURATION_S)
        self.assertEqual(times.count(engine_times[-1]), 1)
        self.assertEqual(times[1:-1], expected[1:-1])
        self.assertNotIn(TINY_DURATION_S, times[1:-1])
        self.assertEqual(len(times), len(set(times)))
        self.assertEqual(times, sorted(times))
        self.assertEqual(
            worker.next_kinematics_step_s(
                TINY_STEP_S, TINY_DURATION_S, TINY_STEP_S, False
            ),
            TINY_STEP_S,
        )
        self.assertEqual(
            worker.next_kinematics_step_s(
                expected[-2], TINY_DURATION_S, TINY_STEP_S, True
            ),
            leftover,
        )

    def test_helpers_publish_engine_time_and_never_relabel(self):
        self.assertFalse(hasattr(worker, "published_sample_time_s"))
        self.assertEqual(
            worker.next_kinematics_step_s(0.0, LIVE_DURATION_S, LIVE_STEP_S, False),
            LIVE_STEP_S,
        )
        self.assertEqual(
            worker.next_kinematics_step_s(
                LIVE_ENGINE_TERMINAL, LIVE_DURATION_S, LIVE_STEP_S, False
            ),
            LIVE_DURATION_S - LIVE_ENGINE_TERMINAL,
        )
        self.assertEqual(
            worker.next_kinematics_step_s(
                LIVE_ENGINE_TERMINAL, LIVE_DURATION_S, LIVE_STEP_S, True
            ),
            LIVE_DURATION_S - LIVE_ENGINE_TERMINAL,
        )
        self.assertFalse(worker.should_store_sample(1, 20, False))
        self.assertTrue(worker.should_store_sample(20, 20, False))
        self.assertTrue(worker.should_store_sample(10_000, 20, True))
        self.assertFalse(worker.should_store_sample(8, 3, False))
        self.assertTrue(worker.should_store_sample(9, 3, False))
        self.assertTrue(worker.should_store_sample(7, 3, True))
        self.assertTrue(worker.should_store_sample(10, 3, True))
        self.assertFalse(
            worker.is_final_logical_step(
                9, 10, 0.8999999999999999, LIVE_DURATION_S, LIVE_STEP_S
            )
        )
        self.assertTrue(
            worker.is_final_logical_step(
                10, 10, LIVE_ENGINE_TERMINAL, LIVE_DURATION_S, LIVE_STEP_S
            )
        )
        self.assertTrue(
            worker.is_final_logical_step(
                10, 10, LIVE_DURATION_S, LIVE_DURATION_S, LIVE_STEP_S
            )
        )
        self.assertTrue(worker.is_final_logical_step(7, 8, 0.07, 0.07, 0.01))
        self.assertFalse(
            worker.is_final_logical_step(6, 8, 0.060000000000000005, 0.07, 0.01)
        )

    def test_off_cadence_final_step_is_stored_once(self):
        engine_times, times = replay_sample_times(LIVE_DURATION_S, LIVE_STEP_S, 3)
        self.assertEqual(len(engine_times) - 1, 10)
        self.assertEqual(len(times), 5)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], engine_times[-1])
        self.assertEqual(engine_times[-1], LIVE_DURATION_S)
        self.assertEqual(times.count(engine_times[-1]), 1)
        self.assertNotIn(LIVE_ENGINE_TERMINAL, engine_times)

    def test_subnormal_400_step_ratio_publishes_every_tick(self):
        self.assertEqual(SUBNORMAL_DURATION_S, 400 * SUBNORMAL_STEP_S)
        self.assertEqual(SUBNORMAL_DURATION_S / SUBNORMAL_STEP_S, 400.0)
        premature = 398 * SUBNORMAL_STEP_S
        self.assertEqual(SUBNORMAL_DURATION_S - premature, 2 * SUBNORMAL_STEP_S)

        engine_times, times = replay_sample_times(
            SUBNORMAL_DURATION_S, SUBNORMAL_STEP_S
        )
        expected = [index * SUBNORMAL_STEP_S for index in range(401)]
        self.assertEqual(len(times), 401)
        self.assertEqual(len(engine_times) - 1, 400)
        self.assertEqual(engine_times, expected)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], engine_times[-1])
        self.assertEqual(times[1:-1], expected[1:-1])
        self.assertNotIn(SUBNORMAL_DURATION_S, times[1:-1])
        self.assertEqual(engine_times[-1], SUBNORMAL_DURATION_S)
        self.assertEqual(times.count(engine_times[-1]), 1)
        self.assertEqual(len(times), len(set(times)))
        self.assertEqual(times, sorted(times))
        self.assertEqual(
            worker.next_kinematics_step_s(
                premature, SUBNORMAL_DURATION_S, SUBNORMAL_STEP_S, False
            ),
            SUBNORMAL_STEP_S,
        )
        self.assertEqual(
            worker.next_kinematics_step_s(
                399 * SUBNORMAL_STEP_S, SUBNORMAL_DURATION_S, SUBNORMAL_STEP_S, True
            ),
            SUBNORMAL_STEP_S,
        )

    def test_ceil_overcount_off_cadence_still_stores_converged_step_once(self):
        duration_s = 0.07
        step_s = 0.01
        self.assertEqual(duration_s / step_s, 7.000000000000001)
        self.assertEqual(worker.planned_step_count(duration_s, step_s), 8)
        engine = 0.0
        for _ in range(7):
            engine += step_s
        self.assertEqual(engine, duration_s)

        engine_times, times = replay_sample_times(duration_s, step_s, 3)
        self.assertEqual(len(engine_times) - 1, 7)
        self.assertEqual(engine_times[-1], duration_s)
        self.assertEqual(len(times), 4)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[1], 0.03)
        self.assertEqual(times[2], 0.060000000000000005)
        self.assertEqual(times[-1], engine_times[-1])
        self.assertEqual(times.count(engine_times[-1]), 1)
        self.assertNotIn(duration_s, times[:-1])
        self.assertEqual(
            worker.next_kinematics_step_s(duration_s, duration_s, step_s, False),
            0.0,
        )
        self.assertEqual(
            worker.next_kinematics_step_s(duration_s, duration_s, step_s, True),
            0.0,
        )

    def test_tiny_ceil_overcount_with_wide_cadence_still_stores_engine_time(self):
        duration_s = 6.999999999999999e-11
        step_s = 9.999999999999998e-12
        self.assertEqual(duration_s / step_s, 7.000000000000001)
        self.assertEqual(worker.planned_step_count(duration_s, step_s), 8)
        engine_times, times = replay_sample_times(duration_s, step_s, 20)
        self.assertEqual(len(engine_times) - 1, 7)
        self.assertEqual(len(times), 2)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], engine_times[-1])
        self.assertEqual(engine_times[-1], duration_s)
        self.assertEqual(times.count(engine_times[-1]), 1)

    def test_underflow_ratio_still_takes_one_remaining_duration_step(self):
        duration_s = SUBNORMAL_STEP_S
        step_s = 10.0
        self.assertEqual(duration_s / step_s, 0.0)
        self.assertEqual(worker.planned_step_count(duration_s, step_s), 1)
        self.assertEqual(
            worker.next_kinematics_step_s(0.0, duration_s, step_s, True),
            duration_s,
        )
        engine_times, times = replay_sample_times(duration_s, step_s)
        self.assertEqual(len(engine_times) - 1, 1)
        self.assertEqual(engine_times[-1], duration_s)
        self.assertEqual(len(times), 2)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], engine_times[-1])
        self.assertEqual(times.count(engine_times[-1]), 1)

    def test_one_over_ten_thousand_cadence_twenty_does_not_take_an_epsilon_step(self):
        drifted = 0.0
        for _ in range(10_000):
            drifted += FINE_STEP_S
        self.assertEqual(drifted, FINE_ENGINE_TERMINAL)
        self.assertLess(drifted, FINE_DURATION_S)
        leftover_if_blind = FINE_DURATION_S - drifted
        self.assertGreater(leftover_if_blind, 0.0)
        self.assertLess(leftover_if_blind, FINE_STEP_S)
        self.assertGreater(leftover_if_blind, 2 * math.ulp(drifted))

        after_9999 = 0.0
        for _ in range(9_999):
            after_9999 += FINE_STEP_S
        leftover = FINE_DURATION_S - after_9999
        self.assertGreater(leftover, FINE_STEP_S)
        self.assertEqual(
            worker.next_kinematics_step_s(
                after_9999, FINE_DURATION_S, FINE_STEP_S, False
            ),
            FINE_STEP_S,
        )
        self.assertEqual(
            worker.next_kinematics_step_s(
                after_9999, FINE_DURATION_S, FINE_STEP_S, True
            ),
            leftover,
        )
        self.assertEqual(after_9999 + leftover, FINE_DURATION_S)

        engine_times, times = replay_sample_times(
            FINE_DURATION_S, FINE_STEP_S, FINE_SAMPLE_EVERY_STEPS
        )
        self.assertEqual(len(engine_times) - 1, 10_000)
        self.assertEqual(engine_times[-1], FINE_DURATION_S)
        self.assertEqual(times[-1], engine_times[-1])
        self.assertNotIn(FINE_ENGINE_TERMINAL, engine_times)
        self.assertEqual(len(times), 501)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times.count(engine_times[-1]), 1)
        self.assertNotIn(drifted, times)
        self.assertNotIn(FINE_DURATION_S, times[:-1])
        self.assertEqual(len(times), len(set(times)))
        self.assertEqual(times, sorted(times))


class _Vec:
    def __init__(self, x=0, y=0, z=0):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)

    def GetItem(self, index):
        return 0.0


class _Quat:
    def __init__(self, e0=1, e1=0, e2=0, e3=0):
        self.e0 = float(e0)
        self.e1 = float(e1)
        self.e2 = float(e2)
        self.e3 = float(e3)


class _Body:
    def SetFixed(self, *_):
        return None

    def EnableCollision(self, *_):
        return None

    def SetPos(self, *_):
        return None

    def SetRot(self, *_):
        return None

    def GetPos(self):
        return _Vec()

    def GetRot(self):
        return _Quat()


class _Frame:
    def __init__(self, *_):
        return None


class _Ramp:
    def __init__(self, *_):
        return None


class _Motor:
    def Initialize(self, *_):
        return None

    def SetAngleFunction(self, *_):
        return None

    def GetMotorAngle(self):
        return 0.0

    def GetConstraintViolation(self):
        return _Vec()


class FakeSystem:
    def __init__(self, *, clock=None, fail_on_step=None):
        self.t = 0.0
        self.steps = []
        self.clock = clock
        self.fail_on_step = fail_on_step

    def SetGravitationalAcceleration(self, *_):
        return None

    def AddBody(self, *_):
        return None

    def AddLink(self, *_):
        return None

    def GetChTime(self):
        if self.clock is not None:
            return self.clock(self.t)
        return self.t

    def DoStepKinematics(self, h):
        self.steps.append(float(h))
        self.t += float(h)
        if self.fail_on_step is not None and len(self.steps) == self.fail_on_step:
            return 0
        return 1


def one_joint_payload(duration_s=LIVE_DURATION_S, step_s=LIVE_STEP_S, sample_every_steps=1):
    return {
        "bodies": [
            {
                "id": "root",
                "fixed": True,
                "absolute_com_pose": {
                    "position_m": [0, 0, 0],
                    "rotation_wxyz": [1, 0, 0, 0],
                },
            },
            {
                "id": "arm",
                "fixed": False,
                "absolute_com_pose": {
                    "position_m": [0, 0, 1],
                    "rotation_wxyz": [1, 0, 0, 0],
                },
            },
        ],
        "joints": [{
            "id": "hinge",
            "parent_body": "root",
            "child_body": "arm",
            "absolute_joint_frame": {
                "position_m": [0, 0, 0],
                "rotation_wxyz": [1, 0, 0, 0],
            },
            "angle_ramp": {"initial_angle_rad": 0, "angular_speed_rad_s": 0.5},
            "limits_rad": [-1, 1],
        }],
        "duration_s": duration_s,
        "step_s": step_s,
        "sample_every_steps": sample_every_steps,
    }


@contextmanager
def fake_pychrono(system):
    pychrono = types.ModuleType("pychrono")
    core = types.ModuleType("pychrono.core")
    core.VNULL = object()
    core.ChVector3d = _Vec
    core.ChQuaterniond = _Quat
    core.ChBody = _Body
    core.ChFramed = _Frame
    core.ChFunctionRamp = _Ramp
    core.ChLinkMotorRotationAngle = _Motor
    core.ChSystemNSC = lambda: system
    pychrono.core = core
    saved = {name: sys.modules.get(name) for name in ("pychrono", "pychrono.core")}
    sys.modules["pychrono"] = pychrono
    sys.modules["pychrono.core"] = core
    try:
        yield system
    finally:
        for name, module in saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


class ChronoWorkerPublishedClockTests(unittest.TestCase):
    def test_main_live_one_tenth_takes_ten_motor_steps_and_publishes_engine_clock(self):
        system = FakeSystem()
        with fake_pychrono(system):
            result = worker.main(one_joint_payload())
        times = [sample["time_s"] for sample in result["samples"]]
        self.assertEqual(system.steps[0], 0.0)
        self.assertEqual(len(system.steps) - 1, 10)
        self.assertEqual(system.steps[-1], LIVE_DURATION_S - 0.8999999999999999)
        self.assertNotEqual(system.steps[-1], LIVE_STEP_S)
        self.assertEqual(len(times), 11)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], system.GetChTime())
        self.assertEqual(system.GetChTime(), LIVE_DURATION_S)
        self.assertEqual(result["execution_state"], "completed")

    def test_main_does_not_relabel_a_short_engine_terminal_to_duration(self):
        def clock(internal):
            if internal == LIVE_DURATION_S:
                return LIVE_ENGINE_TERMINAL
            return internal

        system = FakeSystem(clock=clock)
        with fake_pychrono(system):
            result = worker.main(one_joint_payload())
        times = [sample["time_s"] for sample in result["samples"]]
        self.assertEqual(times[-1], system.GetChTime())
        self.assertEqual(times[-1], LIVE_ENGINE_TERMINAL)
        self.assertNotEqual(times[-1], LIVE_DURATION_S)
        self.assertEqual(len(system.steps) - 1, 10)
        self.assertEqual(result["execution_state"], "completed")

    def test_main_t0_and_not_converged_publish_engine_clock(self):
        assembly = FakeSystem(fail_on_step=1)
        with fake_pychrono(assembly):
            result = worker.main(one_joint_payload())
        self.assertEqual(result["execution_state"], "not_converged")
        self.assertEqual(len(result["samples"]), 1)
        self.assertEqual(result["samples"][0]["time_s"], assembly.GetChTime())
        self.assertEqual(result["samples"][0]["time_s"], 0.0)

        later = FakeSystem(fail_on_step=2)
        with fake_pychrono(later):
            result = worker.main(one_joint_payload())
        times = [sample["time_s"] for sample in result["samples"]]
        self.assertEqual(result["execution_state"], "not_converged")
        self.assertEqual(times[-1], later.GetChTime())
        self.assertEqual(times[-1], LIVE_STEP_S)
        self.assertNotEqual(times[-1], LIVE_DURATION_S)
        self.assertEqual(len(times), 2)


if __name__ == "__main__":
    unittest.main()
