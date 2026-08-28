import { assertEquals, assertThrows } from "@std/assert";
import { toRunRecordView } from "../src/domain/result-view.ts";
import { ChronoError } from "../src/domain/errors.ts";
import type { RunRecord } from "../src/domain/types.ts";
import { observation } from "./test-helpers.ts";

const record: RunRecord = {
  request: { request_id: "paged-run", case_sha256: "a".repeat(64) },
  case_uri: `chrono-case:sha256:${"a".repeat(64)}`,
  recorded_at: "2026-08-28T00:00:00.000Z",
  output: observation(20),
  receipt: {
    schema_id: "chrono-prescribed-kinematics-receipt/1.0",
    receipt_sha256: "b".repeat(64),
    case_sha256: "a".repeat(64),
    outcome_sha256: "c".repeat(64),
    request_id: "paged-run",
    recorded_at: "2026-08-28T00:00:00.000Z",
    package: { name: "@casys/mcp-chrono", version: "0.3.0" },
    provider: { name: "casys-chrono", version: "0.3.0" },
    worker: { source_sha256: "d".repeat(64) },
    runtime: { binding: "pychrono", python_version: "3.12.0" },
    execution_state: "completed",
    kinematics_exit: { raw_code: 1, raw_name: "SUCCESS" },
  },
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
