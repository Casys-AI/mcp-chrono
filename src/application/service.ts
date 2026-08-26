import { ChronoError } from "../domain/errors.ts";
import { requireSha256, sha256Utf8 } from "../domain/sha.ts";
import type {
  PrescribedKinematicsCase,
  RunLookup,
  RunObservation,
  RunRecord,
  RunRequest,
} from "../domain/types.ts";
import { validateCase } from "../domain/validate.ts";
import { FileChronoStore } from "./store.ts";

export interface ChronoRunner {
  run(caseData: PrescribedKinematicsCase, timeoutMs: number): Promise<RunObservation>;
}
export interface CaseSubmission {
  case_sha256: string;
  case_uri: string;
}
export interface RunResult {
  replayed: boolean;
  record: RunRecord;
}
export const CASE_URI_PREFIX = "chrono-case:sha256:";
const defaultTimeout = 15_000;
export class ChronoService {
  constructor(
    private readonly store: FileChronoStore,
    private readonly runner: ChronoRunner,
  ) {}
  async submit(caseJson: unknown, declaredSha256: unknown): Promise<CaseSubmission> {
    if (typeof caseJson !== "string") {
      throw new ChronoError(
        "invalid_case_json",
        "case_json must be an exact UTF-8 JSON string.",
      );
    }
    if (new TextEncoder().encode(caseJson).byteLength > 512_000) {
      throw new ChronoError(
        "case_too_large",
        "case_json exceeds the 512 KiB input limit.",
      );
    }
    const sha256 = requireSha256(declaredSha256);
    if (await sha256Utf8(caseJson) !== sha256) {
      throw new ChronoError(
        "case_sha256_mismatch",
        "Declared case_sha256 does not match the submitted UTF-8 bytes.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(caseJson);
    } catch {
      throw new ChronoError("invalid_case_json", "case_json is not valid JSON.");
    }
    validateCase(parsed);
    const uri = await this.store.putCase(new TextEncoder().encode(caseJson), sha256);
    return { case_sha256: sha256, case_uri: uri };
  }
  async run(input: RunRequest): Promise<RunResult> {
    const sha256 = requireSha256(input.case_sha256);
    const request: RunRequest = {
      request_id: input.request_id,
      case_sha256: sha256,
      ...(input.case_uri ? { case_uri: input.case_uri } : {}),
      ...(input.timeout_ms === undefined ? {} : { timeout_ms: input.timeout_ms }),
    };
    if (request.case_uri && request.case_uri !== `${CASE_URI_PREFIX}${sha256}`) {
      throw new ChronoError(
        "case_uri_mismatch",
        "case_uri must exactly match case_sha256.",
      );
    }
    const timeoutMs = request.timeout_ms ?? defaultTimeout;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
      throw new ChronoError(
        "invalid_timeout",
        "timeout_ms must be an integer from 100 through 60000.",
      );
    }
    const existing = await this.store.lookup(request.request_id);
    if (existing.state === "recorded") {
      if (existing.record.request.case_sha256 !== sha256) {
        throw new ChronoError(
          "request_conflict",
          "request_id is already bound to another case.",
        );
      }
      return { replayed: true, record: existing.record };
    }
    if (existing.state === "uncertain") {
      if (existing.intent.request.case_sha256 !== sha256) {
        throw new ChronoError(
          "request_conflict",
          "request_id is already bound to another case.",
        );
      }
      throw new ChronoError(
        "run_uncertain",
        "Intent exists without a recorded result; this provider will not auto-rerun it.",
        { request_id: request.request_id },
      );
    }
    // A missing, corrupt or invalid stored case is rejected before any request
    // identity is claimed. Only a validated case can create dispatch intent.
    const admittedCase = await this.reopenValidatedCase(sha256);
    const caseUri = `${CASE_URI_PREFIX}${sha256}`;
    const intentStatus = await this.store.writeIntent({
      request,
      case_uri: caseUri,
      intent_recorded_at: new Date().toISOString(),
    });
    if (intentStatus === "recorded") {
      const nowRecorded = await this.store.lookup(request.request_id);
      if (nowRecorded.state === "recorded") {
        return { replayed: true, record: nowRecorded.record };
      }
      throw new ChronoError("store_corrupt", "Recorded request state disappeared.");
    }
    if (intentStatus === "uncertain") {
      throw new ChronoError(
        "run_uncertain",
        "Intent exists without a recorded result; this provider will not auto-rerun it.",
        { request_id: request.request_id },
      );
    }
    const output = await this.runner.run(admittedCase, timeoutMs);
    const record: RunRecord = {
      request,
      case_uri: caseUri,
      recorded_at: new Date().toISOString(),
      output,
    };
    await this.store.writeRecorded(record);
    return { replayed: false, record };
  }
  lookup(requestId: string): Promise<RunLookup> {
    return this.store.lookup(requestId);
  }
  private async reopenValidatedCase(sha256: string): Promise<PrescribedKinematicsCase> {
    const bytes = await this.store.reopenCase(sha256);
    let exactText: string;
    try {
      exactText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ChronoError("store_corrupt", "Stored case is not valid UTF-8.");
    }
    if (await sha256Utf8(exactText) !== sha256) {
      throw new ChronoError(
        "store_corrupt",
        "Reopened case bytes failed identity verification.",
      );
    }
    let caseData: unknown;
    try {
      caseData = JSON.parse(exactText);
    } catch {
      throw new ChronoError("store_corrupt", "Stored case bytes are not JSON.");
    }
    try {
      return validateCase(caseData);
    } catch (error) {
      if (error instanceof ChronoError) {
        throw new ChronoError(
          "store_corrupt",
          "Stored case violates the closed contract.",
        );
      }
      throw error;
    }
  }
}
