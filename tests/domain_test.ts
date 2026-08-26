import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Utf8 } from "../src/domain/sha.ts";
import { validateCase } from "../src/domain/validate.ts";
import { ChronoService } from "../src/application/service.ts";
import { FileChronoStore } from "../src/application/store.ts";
import { caseData, FakeRunner } from "./test-helpers.ts";

Deno.test("domain validates a closed explicit root-only case", () => {
  assertEquals(validateCase(caseData()).bodies[0].id, "root");
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
Deno.test("case submission detects declared SHA mismatch before persistence", async () => {
  const root = await Deno.makeTempDir();
  const service = new ChronoService(new FileChronoStore(root), new FakeRunner());
  await assertRejects(
    () => service.submit(JSON.stringify(caseData()), "0".repeat(64)),
    Error,
    "does not match",
  );
});
Deno.test("case submission stores exact bytes by SHA", async () => {
  const root = await Deno.makeTempDir();
  const text = JSON.stringify(caseData());
  const sha = await sha256Utf8(text);
  const service = new ChronoService(new FileChronoStore(root), new FakeRunner());
  assertEquals((await service.submit(text, sha)).case_uri, `chrono-case:sha256:${sha}`);
});
