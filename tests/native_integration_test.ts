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

  const assembled = source.indexOf("last_flag = system.DoStepKinematics(0.0)");
  const initialSample = source.indexOf("    collect()", assembled);
  assert(assembled >= 0 && initialSample > assembled);
});

Deno.test("native Project Chrono integration is explicit opt-in", async () => {
  if (Deno.env.get("CHRONO_NATIVE_INTEGRATION") !== "1") return;
  const input = oneJointCase();
  const result = await new ChronoWorkerRunner().run(input, 15_000);
  assertEquals(result.engine.version, "10.0.0");
  assertEquals(result.not_evaluated[0], "collision");
  assertEquals(result.execution_state, "completed");
  assertEquals(result.samples[0].time_s, 0);
  assertEquals(result.samples.at(-1)?.time_s, input.duration_s);
  assert(Math.abs(result.samples[0].motors[0].motor_angle_rad ?? NaN) < 1e-9);
  assert(
    Math.abs(
      (result.samples.at(-1)?.motors[0].motor_angle_rad ?? NaN) -
        (input.joints[0].angle_ramp.initial_angle_rad +
          input.joints[0].angle_ramp.angular_speed_rad_s * input.duration_s),
    ) < 1e-6,
  );
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

  const t0 = (await new ChronoWorkerRunner().run(input, 15_000)).samples[0];
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
