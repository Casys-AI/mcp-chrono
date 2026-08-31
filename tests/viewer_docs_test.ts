import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseChronoViewerSession } from "../src/viewer-session.ts";

Deno.test("documentation viewer fixture is explicit and contract-valid", async () => {
  const source = await Deno.readTextFile(
    new URL("../docs/fixtures/recorded-run-session.demo.json", import.meta.url),
  );
  const session = await parseChronoViewerSession(JSON.parse(source));
  assertEquals(session.projection.status, "available");
  assertStringIncludes(session.anchor.id, "documentation-fixture");
  assertStringIncludes(session.anchor.id, "not-evidence");

  const preview = await Deno.readTextFile(
    new URL("../docs/fixtures/viewer-preview.html", import.meta.url),
  );
  assertStringIncludes(preview, "Contract preview — not execution evidence");

  const readme = await Deno.readTextFile(new URL("../README.md", import.meta.url));
  assertStringIncludes(readme, "docs/assets/chrono-recorded-run-viewer.png");
  assert(!/\b\d+\s+tools?\b/i.test(readme), "README must not advertise a tool count");
});
