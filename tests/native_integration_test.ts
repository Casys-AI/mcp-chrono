import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ChronoWorkerRunner } from "../src/adapters/chrono/runner.ts";
import { oneJointCase } from "./test-helpers.ts";

Deno.test("worker source names the fixed Chrono 10 kinematic API", async () => {
  // This is intentionally a static contract check. It is not a claim that a
  // local interpreter has loaded the native engine; that check stays opt-in.
  const source = await Deno.readTextFile(
    new URL("../scripts/chrono_worker.py", import.meta.url),
  );

  assertStringIncludes(
    source,
    "system.SetGravitationalAcceleration(chrono.VNULL)",
  );
  assert(!source.includes("Set_G_acc("));
  assert(!source.includes("importlib.metadata"));
  assert(!source.includes("CHRONO_VERSION"));
  assertStringIncludes(source, "REQUIRED_CHRONO_SYMBOLS");
  assertStringIncludes(source, "REQUIRED_MOTOR_METHODS");
  assertStringIncludes(source, "require_chrono_runtime(chrono)");
  assertStringIncludes(source, "motor.GetMotorAngle()");
  assert(!source.includes("GetMotorRot"));
  assertStringIncludes(
    source,
    'motor.Initialize(bodies[spec["child_body"]], bodies[spec["parent_body"]], frame)',
  );
  assertStringIncludes(source, "last_flag = system.DoStepKinematics(0.0)");
  assertStringIncludes(source, "Submitted poses are zero-angle references");
  assertStringIncludes(source, '0: "NOT_CONVERGED"');
  assertStringIncludes(source, "next_kinematics_step_s(");
  assertStringIncludes(source, "planned_step_count(");
  assertStringIncludes(source, "should_store_sample(");
  assertStringIncludes(source, "is_final_logical_step(");
  assertStringIncludes(source, "max(1, math.ceil(duration_s / step_s))");
  assertStringIncludes(source, "for step_index in range(1, planned_steps + 1):");
  assertStringIncludes(source, "time_s = float(system.GetChTime())");
  assertStringIncludes(source, "step_index == planned_steps");
  assert(!source.includes("published_sample_time_s"));
  assert(!source.includes("reached_requested_duration"));
  assert(!source.includes("terminal_time_abs_tol_s"));
  assert(!source.includes("TERMINAL_ULP_MULTIPLIER"));
  assert(!source.includes("math.nextafter"));
  assert(!source.includes("math.isclose"));
  assert(!source.includes("math.ulp"));
  assert(!source.includes("collect(terminal="));
  assert(
    !source.includes('while float(system.GetChTime()) < case["duration_s"]'),
  );

  const assembled = source.indexOf("last_flag = system.DoStepKinematics(0.0)");
  const initialSample = source.indexOf("    collect()", assembled);
  assert(assembled >= 0 && initialSample > assembled);
});

Deno.test("native Project Chrono integration is explicit opt-in", async () => {
  if (Deno.env.get("CHRONO_NATIVE_INTEGRATION") !== "1") return;
  const input = oneJointCase();
  const result = (await new ChronoWorkerRunner().run(input, 15_000)).observation;
  assertEquals(result.engine.version, "10.0.0");
  assertEquals(result.not_evaluated[0], "collision");
  assertEquals(result.execution_state, "completed");
  const times = result.samples.map((sample) => sample.time_s);
  assertEquals(result.samples[0].time_s, 0);
  assertEquals(result.samples.length, 11);
  // Remaining last planned step makes Chrono land on duration factually.
  assertEquals(times.at(-1), 1);
  assertEquals(times.filter((time) => time === times.at(-1)).length, 1);
  assertEquals(new Set(times).size, times.length);
  assert(!times.includes(0.9999999999999999));
  for (let index = 1; index < times.length; index++) {
    assert(times[index] > times[index - 1]);
  }
  assert(Math.abs(result.samples[0].motors[0].motor_angle_rad ?? NaN) < 1e-9);
  assert(
    Math.abs(
      (result.samples.at(-1)?.motors[0].motor_angle_rad ?? NaN) -
        (input.joints[0].angle_ramp.initial_angle_rad +
          input.joints[0].angle_ramp.angular_speed_rad_s * (times.at(-1) ?? NaN)),
    ) < 1e-6,
  );
});

Deno.test("native non-dividing duration records the exact terminal tick once", async () => {
  if (Deno.env.get("CHRONO_NATIVE_INTEGRATION") !== "1") return;
  const input = oneJointCase();
  input.step_s = 0.3;
  const result = (await new ChronoWorkerRunner().run(input, 15_000)).observation;
  const times = result.samples.map((sample) => sample.time_s);
  assertEquals(result.execution_state, "completed");
  assertEquals(result.samples.length, 5);
  assertEquals(times[0], 0);
  assertEquals(times[1], 0.3);
  assertEquals(times[2], 0.6);
  assertEquals(times[3], 0.8999999999999999);
  assertEquals(times.at(-1), 1);
  assertEquals(times.filter((time) => time === times.at(-1)).length, 1);
  assertEquals(new Set(times).size, times.length);
});

Deno.test("native t=0 applies the initial angle to zero-angle references", async () => {
  if (Deno.env.get("CHRONO_NATIVE_INTEGRATION") !== "1") return;
  const input = oneJointCase();
  input.bodies[1] = {
    ...input.bodies[1],
    absolute_com_pose: { position_m: [1, 0, 0], rotation_wxyz: [1, 0, 0, 0] },
  };
  input.joints[0] = {
    ...input.joints[0],
    angle_ramp: { initial_angle_rad: 0.5, angular_speed_rad_s: 0 },
  };

  const t0 = (await new ChronoWorkerRunner().run(input, 15_000)).observation.samples[0];
  const close = (actual: number, expected: number) =>
    assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

  close(t0.motors[0].motor_angle_rad ?? NaN, 0.5);
  for (
    const [actual, expected] of [
      [t0.bodies[1].position_m[0], 0.8775825619],
      [t0.bodies[1].position_m[1], 0.4794255386],
      [t0.bodies[1].position_m[2], 0],
      [t0.bodies[1].rotation_wxyz[0], 0.9689124217],
      [t0.bodies[1].rotation_wxyz[1], 0],
      [t0.bodies[1].rotation_wxyz[2], 0],
      [t0.bodies[1].rotation_wxyz[3], 0.2474039593],
    ]
  ) {
    close(actual, expected);
  }
});
