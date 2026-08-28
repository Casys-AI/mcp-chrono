import { assertEquals, assertThrows } from "@std/assert";
import { toRunRecordView } from "../src/domain/result-view.ts";
import { ChronoError } from "../src/domain/errors.ts";
import { observation } from "./test-helpers.ts";

const record = {
  request: { request_id: "paged-run", case_sha256: "a".repeat(64) },
  case_uri: `chrono-case:sha256:${"a".repeat(64)}`,
  recorded_at: "2026-08-28T00:00:00.000Z",
  output: observation(20),
};

Deno.test("MCP result views return a summary and a bounded default sample page", () => {
  const view = toRunRecordView(record);
  assertEquals(view.observation.sample_count, 20);
  assertEquals(view.observation.sample_time_range_s, { first: 0, last: 1 });
  assertEquals(view.sample_page.offset, 0);
  assertEquals(view.sample_page.limit, 16);
  assertEquals(view.sample_page.returned, 16);
  assertEquals(view.sample_page.total, 20);
  assertEquals(view.sample_page.has_more, true);
  assertEquals(view.sample_page.samples.at(-1)?.time_s, 15 / 19);
});

Deno.test("MCP result views page the durable observation deterministically", () => {
  const view = toRunRecordView(record, { sample_offset: 16, sample_limit: 4 });
  assertEquals(view.sample_page.returned, 4);
  assertEquals(view.sample_page.has_more, false);
  assertEquals(view.sample_page.samples[0].time_s, 16 / 19);
  assertEquals(view.sample_page.samples.at(-1)?.time_s, 1);
});

Deno.test("MCP result views reject unbounded or invalid page arguments", () => {
  assertThrows(
    () => toRunRecordView(record, { sample_limit: 65 }),
    ChronoError,
    "sample_limit",
  );
  assertThrows(
    () => toRunRecordView(record, { sample_offset: -1 }),
    ChronoError,
    "sample_offset",
  );
});
