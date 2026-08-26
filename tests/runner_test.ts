import { assertEquals, assertRejects } from "@std/assert";
import { ChronoWorkerRunner } from "../src/adapters/chrono/runner.ts";
import { caseData, oneJointCase, workerObservation } from "./test-helpers.ts";

async function worker(source: string): Promise<string> {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/worker.py`;
  await Deno.writeTextFile(path, source);
  return path;
}
Deno.test("worker boundary reports timeout", async () => {
  const path = await worker("import time\ntime.sleep(2)\n");
  await assertRejects(
    () => new ChronoWorkerRunner(path, "python3").run(caseData(), 100),
    Error,
    "timed out",
  );
});
Deno.test("worker boundary reports unsuccessful worker", async () => {
  const path = await worker(
    "import sys\nprint('bad worker', file=sys.stderr)\nsys.exit(2)\n",
  );
  await assertRejects(
    () => new ChronoWorkerRunner(path, "python3").run(caseData(), 1000),
    Error,
    "exited unsuccessfully",
  );
});
Deno.test("worker boundary rejects over-bound output", async () => {
  const path = await worker("print('x' * (4 * 1024 * 1024 + 1))\n");
  await assertRejects(
    () => new ChronoWorkerRunner(path, "python3").run(caseData(), 5000),
    Error,
    "bounded output pipe",
  );
});
Deno.test("worker boundary accepts the exact one-joint observation contract", async () => {
  const input = oneJointCase();
  const path = await worker(
    `import json, sys\njson.load(sys.stdin)\nprint(${
      JSON.stringify(JSON.stringify(workerObservation(input)))
    })\n`,
  );
  const output = await new ChronoWorkerRunner(path, "python3").run(input, 1000);
  assertEquals(output.samples.length, 2);
  assertEquals(output.samples[0].motors[0].joint_id, "hinge");
  assertEquals(output.samples[1].time_s, input.duration_s);
});
Deno.test("worker boundary records known NOT_CONVERGED as an observation", async () => {
  const input = oneJointCase();
  const payload = workerObservation(input);
  payload.execution_state = "not_converged";
  payload.kinematics_exit = { raw_code: 1, raw_name: "NOT_CONVERGED" };
  payload.samples = (payload.samples as unknown[]).slice(0, 1);
  const path = await worker(
    `import json, sys\njson.load(sys.stdin)\nprint(${
      JSON.stringify(JSON.stringify(payload))
    })\n`,
  );
  const output = await new ChronoWorkerRunner(path, "python3").run(input, 1000);
  assertEquals(output.execution_state, "not_converged");
  assertEquals(output.kinematics_exit.raw_name, "NOT_CONVERGED");
});
Deno.test("worker boundary rejects malformed output before it can be recorded", async () => {
  const input = oneJointCase();
  const payload = workerObservation(input);
  payload.samples = [{ time_s: 0, bodies: [], motors: [] }];
  const path = await worker(
    `import json, sys\njson.load(sys.stdin)\nprint(${
      JSON.stringify(JSON.stringify(payload))
    })\n`,
  );
  await assertRejects(
    () => new ChronoWorkerRunner(path, "python3").run(input, 1000),
    Error,
    "body cardinality",
  );
});
