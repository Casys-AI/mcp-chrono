import {
  DEFAULT_SAMPLE_PAGE_LIMIT,
  MAX_SAMPLE_PAGE_LIMIT,
  MAX_SAMPLE_PAGE_OFFSET,
} from "./contract.ts";
import { ChronoError } from "./errors.ts";
import type {
  KinematicsSample,
  RunObservation,
  RunRecord,
  RunRecordView,
  SamplePage,
} from "./types.ts";

export interface SamplePageRequest {
  sample_offset?: unknown;
  sample_limit?: unknown;
}

export function normalizeSamplePageRequest(
  request: SamplePageRequest = {},
): { sample_offset: number; sample_limit: number } {
  const sample_offset = request.sample_offset === undefined ? 0 : request.sample_offset;
  if (
    typeof sample_offset !== "number" || !Number.isSafeInteger(sample_offset) ||
    sample_offset < 0 || sample_offset > MAX_SAMPLE_PAGE_OFFSET
  ) {
    throw new ChronoError(
      "invalid_sample_offset",
      `sample_offset must be an integer from 0 through ${MAX_SAMPLE_PAGE_OFFSET}.`,
    );
  }
  const sample_limit = request.sample_limit === undefined
    ? DEFAULT_SAMPLE_PAGE_LIMIT
    : request.sample_limit;
  if (
    typeof sample_limit !== "number" || !Number.isSafeInteger(sample_limit) ||
    sample_limit < 1 || sample_limit > MAX_SAMPLE_PAGE_LIMIT
  ) {
    throw new ChronoError(
      "invalid_sample_limit",
      `sample_limit must be an integer from 1 through ${MAX_SAMPLE_PAGE_LIMIT}.`,
    );
  }
  return { sample_offset, sample_limit };
}

function samplePage(
  samples: KinematicsSample[],
  request: SamplePageRequest,
): SamplePage {
  const { sample_offset, sample_limit } = normalizeSamplePageRequest(request);
  const pageSamples = samples.slice(sample_offset, sample_offset + sample_limit);
  return {
    offset: sample_offset,
    limit: sample_limit,
    total: samples.length,
    returned: pageSamples.length,
    has_more: sample_offset + pageSamples.length < samples.length,
    samples: pageSamples,
  };
}

function summary(output: RunObservation): RunRecordView["observation"] {
  const first = output.samples[0];
  const last = output.samples.at(-1);
  if (!first || !last) {
    throw new ChronoError("store_corrupt", "Recorded observation has no samples.");
  }
  return {
    engine: output.engine,
    execution_state: output.execution_state,
    kinematics_exit: output.kinematics_exit,
    not_evaluated: output.not_evaluated,
    sample_count: output.samples.length,
    sample_time_range_s: { first: first.time_s, last: last.time_s },
  };
}

/**
 * Build the only MCP result shape for recorded observations. The durable ledger
 * stays complete on disk; callers receive a bounded page so it cannot flood
 * their context or a transport response.
 */
export function toRunRecordView(
  record: RunRecord,
  request: SamplePageRequest = {},
): RunRecordView {
  return {
    request: record.request,
    case_uri: record.case_uri,
    recorded_at: record.recorded_at,
    observation: summary(record.output),
    sample_page: samplePage(record.output.samples, request),
  };
}
