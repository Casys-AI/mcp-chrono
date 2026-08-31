import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ChronoService } from "../src/application/service.ts";
import { FileChronoStore } from "../src/application/store.ts";
import {
  CASE_INVARIANTS,
  CASE_JSON_SCHEMA,
  CASE_TEMPLATE,
  MAX_CASE_JSON_BYTES,
} from "../src/domain/contract.ts";
import { ChronoError } from "../src/domain/errors.ts";
import { sha256Utf8 } from "../src/domain/sha.ts";
import { validateCase } from "../src/domain/validate.ts";
import { caseData, FakeRunner } from "./test-helpers.ts";

Deno.test("domain validates a closed explicit root-only case", () => {
  assertEquals(validateCase(caseData()).bodies[0].id, "root");
});
Deno.test("domain admits the 10000-step cadence-20 schedule", () => {
  const input = caseData();
  input.duration_s = 1;
  input.step_s = 0.0001;
  input.sample_every_steps = 20;
  const validated = validateCase(input);
  assertEquals(validated.duration_s, 1);
  assertEquals(validated.step_s, 0.0001);
  assertEquals(validated.sample_every_steps, 20);
});
Deno.test("domain admits a ceil-overcount decimal schedule", () => {
  const input = caseData();
  input.duration_s = 0.07;
  input.step_s = 0.01;
  input.sample_every_steps = 3;
  const validated = validateCase(input);
  assertEquals(validated.duration_s, 0.07);
  assertEquals(validated.step_s, 0.01);
  assertEquals(validated.sample_every_steps, 3);
});
Deno.test("runtime template is a valid closed 1.0 case", () => {
  assertEquals(validateCase(CASE_TEMPLATE).joints[0].id, "hinge");
  assertEquals(CASE_JSON_SCHEMA.$id, "chrono-prescribed-kinematics-case/1.0");
  assertEquals(CASE_JSON_SCHEMA.additionalProperties, false);
  assertEquals(
    CASE_JSON_SCHEMA.properties.sample_every_steps.maximum,
    Number.MAX_SAFE_INTEGER,
  );
  assert(CASE_INVARIANTS.some((invariant) => invariant.id === "unique-identities"));
});
Deno.test("case submission enforces the documented 512 KiB UTF-8 boundary", async () => {
  const service = new ChronoService(
    new FileChronoStore(await Deno.makeTempDir()),
    new FakeRunner(),
  );
  const oversized = JSON.stringify(caseData()) + " ".repeat(MAX_CASE_JSON_BYTES);
  const error = await assertRejects(
    () => service.submit(oversized),
    ChronoError,
    "512 KiB UTF-8 input limit",
  );
  assert(error instanceof ChronoError);
  assertEquals(error.code, "case_too_large");
});
Deno.test("domain rejects unknown properties and missing tree children", () => {
  assertThrows(
    () => validateCase({ ...caseData(), extra: true }),
    Error,
    "unsupported property",
  );
  const bad = caseData();
  bad.bodies.push({
    id: "other",
    fixed: false,
    absolute_com_pose: { position_m: [0, 0, 0], rotation_wxyz: [1, 0, 0, 0] },
  });
  assertThrows(() => validateCase(bad), Error, "tree");
});
Deno.test("case submission returns its computed digest without an expected hash", async () => {
  const root = await Deno.makeTempDir();
  const service = new ChronoService(new FileChronoStore(root), new FakeRunner());
  const text = JSON.stringify(caseData());
  const sha = await sha256Utf8(text);
  assertEquals(
    await service.submit(text),
    { case_sha256: sha, case_uri: `chrono-case:sha256:${sha}` },
  );
});
Deno.test("case submission fails closed on a mismatched expected hash and returns actual", async () => {
  const root = await Deno.makeTempDir();
  const service = new ChronoService(new FileChronoStore(root), new FakeRunner());
  const text = JSON.stringify(caseData());
  const actual = await sha256Utf8(text);
  const error = await assertRejects(
    () => service.submit(text, "0".repeat(64)),
    ChronoError,
    "does not match",
  );
  assert(error instanceof ChronoError);
  assertEquals(error.code, "case_sha256_mismatch");
  assertEquals(error.details, {
    expected_case_sha256: "0".repeat(64),
    actual_case_sha256: actual,
  });
  await assertRejects(
    () => new FileChronoStore(root).reopenCase(actual),
    ChronoError,
    "No stored case",
  );
});
Deno.test("case submission stores exact bytes by SHA", async () => {
  const root = await Deno.makeTempDir();
  const text = JSON.stringify(caseData());
  const sha = await sha256Utf8(text);
  const service = new ChronoService(new FileChronoStore(root), new FakeRunner());
  assertEquals((await service.submit(text, sha)).case_uri, `chrono-case:sha256:${sha}`);
});
