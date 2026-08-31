import { dirname } from "node:path";
import { ChronoError } from "../domain/errors.ts";
import {
  persistedRecordCaseSha256,
  validatePersistedIntent,
  validatePersistedRecord,
} from "../domain/persisted-run.ts";
import { requireSha256, sha256Bytes } from "../domain/sha.ts";
import type {
  PrescribedKinematicsCase,
  RunIntent,
  RunLookup,
  RunRecord,
} from "../domain/types.ts";
import { validateCase } from "../domain/validate.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

async function writeFully(file: Deno.FsFile, value: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const written = await file.write(value.subarray(offset));
    if (written <= 0) {
      throw new ChronoError(
        "store_write_failed",
        "Durable store made no write progress.",
      );
    }
    offset += written;
  }
  await file.sync();
}

/** Atomically create an immutable entry without ever overwriting a prior one. */
async function publishNew(
  directory: string,
  name: string,
  value: Uint8Array,
): Promise<"written" | "exists"> {
  const target = `${directory}/${name}`;
  const temp = `${directory}/.${name}.${crypto.randomUUID()}.tmp`;
  let file: Deno.FsFile | undefined;
  let outcome: "written" | "exists" | undefined;
  let failure: unknown;
  try {
    file = await Deno.open(temp, { write: true, createNew: true, mode: 0o600 });
    await writeFully(file, value);
    file.close();
    file = undefined;
    try {
      // link(2) creates target only if absent. The source is fully fsynced and
      // lives in the target directory's filesystem.
      await Deno.link(temp, target);
      await syncDirectory(directory);
      outcome = "written";
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) outcome = "exists";
      else throw error;
    }
  } catch (error) {
    failure = error;
  }
  try {
    file?.close();
  } catch { /* file was already closed after sync */ }
  try {
    await Deno.remove(temp);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound) && failure === undefined) {
      failure = error;
    }
  }
  if (failure !== undefined) throw failure;
  if (outcome === undefined) {
    throw new ChronoError(
      "store_write_failed",
      "Durable store did not publish an outcome.",
    );
  }
  return outcome;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await Deno.open(directory, { read: true });
  try {
    await handle.sync();
  } finally {
    handle.close();
  }
}

async function createDirectory(directory: string): Promise<void> {
  try {
    await Deno.mkdir(directory);
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  try {
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch {
    throw new ChronoError("store_corrupt", "Ledger JSON is malformed.");
  }
}

/** Durable content-addressed case store and single-record request ledger. */
export class FileChronoStore {
  constructor(readonly root: string) {}
  private casesDir(): string {
    return `${this.root}/cases`;
  }
  private requestsDir(): string {
    return `${this.root}/requests`;
  }
  private receiptsDir(): string {
    return `${this.root}/receipts`;
  }
  private casePath(hash: string): string {
    return `${this.casesDir()}/${hash}.json`;
  }
  private requestDir(requestId: string): string {
    return `${this.requestsDir()}/${requestId}`;
  }
  private receiptPath(receiptSha256: string): string {
    return `${this.receiptsDir()}/${receiptSha256}.json`;
  }
  async initialize(): Promise<void> {
    // Directory entries are made durable by syncing their parent. Do this before
    // publishing a file inside a newly created directory, otherwise a power loss
    // can retain the file link without retaining a path to its directory.
    try {
      await Deno.stat(this.root);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await Deno.mkdir(this.root, { recursive: true });
      await syncDirectory(dirname(this.root));
    }
    await createDirectory(this.casesDir());
    await syncDirectory(this.root);
    await createDirectory(this.requestsDir());
    await syncDirectory(this.root);
    await createDirectory(this.receiptsDir());
    await syncDirectory(this.root);
  }
  async putCase(bytes: Uint8Array, expectedSha256: string): Promise<string> {
    await this.initialize();
    const hash = requireSha256(expectedSha256);
    const actual = await sha256Bytes(bytes);
    if (actual !== hash) {
      throw new ChronoError(
        "case_sha256_mismatch",
        "Expected case_sha256 does not match the submitted UTF-8 bytes.",
        { expected_case_sha256: hash, actual_case_sha256: actual },
      );
    }
    const outcome = await publishNew(this.casesDir(), `${hash}.json`, bytes);
    if (outcome === "exists") await this.reopenCase(hash);
    return `chrono-case:sha256:${hash}`;
  }
  async reopenCase(hash: string): Promise<Uint8Array> {
    hash = requireSha256(hash);
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(this.casePath(hash));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new ChronoError("case_not_found", "No stored case has that SHA-256.");
      }
      throw error;
    }
    if (await sha256Bytes(bytes) !== hash) {
      throw new ChronoError(
        "store_corrupt",
        "Stored case bytes no longer match their content address.",
      );
    }
    return bytes;
  }
  async lookup(requestId: string): Promise<RunLookup> {
    this.requireRequestId(requestId);
    const path = this.requestDir(requestId);
    const record = await readJson<unknown>(`${path}/record.json`);
    if (record) {
      try {
        const caseSha256 = persistedRecordCaseSha256(record, requestId);
        const input = await this.reopenPersistedCase(caseSha256);
        const validated = await validatePersistedRecord(record, requestId, input);
        // A power loss can occur after a request record is atomically published
        // but before its secondary receipt index. Only an exact 0.3.2 attested
        // record contains the receipt identity needed to derive that index.
        await this.publishReceiptIndex(
          validated,
          encoder.encode(JSON.stringify(record)),
        );
        return {
          state: "recorded",
          record: validated,
        };
      } catch {
        throw new ChronoError("store_corrupt", "Persisted run record is invalid.");
      }
    }
    const intent = await readJson<RunIntent>(`${path}/intent.json`);
    if (!intent) return { state: "absent" };
    try {
      return { state: "uncertain", intent: validatePersistedIntent(intent, requestId) };
    } catch {
      throw new ChronoError("store_corrupt", "Persisted run intent is invalid.");
    }
  }
  async writeIntent(intent: RunIntent): Promise<"written" | "recorded" | "uncertain"> {
    this.requireRequestId(intent.request.request_id);
    await this.initialize();
    const dir = this.requestDir(intent.request.request_id);
    await createDirectory(dir);
    await syncDirectory(this.requestsDir());
    const outcome = await publishNew(
      dir,
      "intent.json",
      encoder.encode(JSON.stringify(intent)),
    );
    if (outcome === "written") return "written";
    const existing = await this.lookup(intent.request.request_id);
    if (
      existing.state === "recorded" &&
      existing.record.request.case_sha256 !== intent.request.case_sha256
    ) {
      throw new ChronoError(
        "request_conflict",
        "request_id is already bound to another case.",
      );
    }
    if (
      existing.state === "uncertain" &&
      existing.intent.request.case_sha256 !== intent.request.case_sha256
    ) {
      throw new ChronoError(
        "request_conflict",
        "request_id is already bound to another case.",
      );
    }
    if (existing.state === "recorded") return "recorded";
    if (existing.state === "uncertain") return "uncertain";
    throw new ChronoError(
      "store_corrupt",
      "A request intent marker exists but cannot be read.",
    );
  }
  async writeRecorded(record: RunRecord): Promise<void> {
    this.requireRequestId(record.request.request_id);
    const caseSha256 = requireSha256(record.request.case_sha256);
    const input = await this.reopenPersistedCase(caseSha256);
    // The receipt digest becomes a filesystem name below. Validate the complete
    // immutable record first so no internal caller can turn that identity into a
    // path, publish a malformed provenance object, or bypass receipt binding.
    const validated = await validatePersistedRecord(
      record,
      record.request.request_id,
      input,
    );
    const dir = this.requestDir(validated.request.request_id);
    const found = await this.lookup(validated.request.request_id);
    if (found.state === "recorded") {
      if (found.record.request.case_sha256 !== validated.request.case_sha256) {
        throw new ChronoError(
          "request_conflict",
          "request_id is already bound to another case.",
        );
      }
      return;
    }
    if (found.state !== "uncertain") {
      throw new ChronoError("store_corrupt", "A run result has no durable intent.");
    }
    if (found.intent.request.case_sha256 !== validated.request.case_sha256) {
      throw new ChronoError(
        "request_conflict",
        "request_id is already bound to another case.",
      );
    }
    const bytes = encoder.encode(JSON.stringify(validated));
    // The request record is the recovery root. Publishing it before its
    // receipt index means a retry by the durable request identity can repair a
    // crash in the second publication step without rerunning native Chrono.
    const outcome = await publishNew(dir, "record.json", bytes);
    if (outcome === "exists") {
      const nowRecorded = await this.lookup(record.request.request_id);
      if (nowRecorded.state === "recorded") return;
      throw new ChronoError("store_corrupt", "Recorded outcome marker is malformed.");
    }
    await this.publishReceiptIndex(validated, bytes);
  }
  async readCaseText(hash: string): Promise<string> {
    try {
      return decoder.decode(await this.reopenCase(hash));
    } catch (error) {
      if (error instanceof ChronoError) throw error;
      throw new ChronoError("store_corrupt", "Stored case is not valid UTF-8.");
    }
  }
  async lookupReceipt(receiptSha256: string): Promise<RunRecord> {
    const receipt = requireSha256(receiptSha256);
    const record = await readJson<unknown>(this.receiptPath(receipt));
    if (!record) {
      throw new ChronoError(
        "receipt_not_found",
        "No stored run has that receipt SHA-256.",
      );
    }
    try {
      const raw = record as { request?: { request_id?: unknown } };
      const requestId = typeof raw.request?.request_id === "string"
        ? raw.request.request_id
        : "";
      const caseSha256 = persistedRecordCaseSha256(record, requestId);
      const input = await this.reopenPersistedCase(caseSha256);
      const validated = await validatePersistedRecord(
        record,
        requestId,
        input,
      );
      if (validated.receipt.receipt_sha256 !== receipt) {
        throw new ChronoError(
          "store_corrupt",
          "Receipt index does not match its run record.",
        );
      }
      return validated;
    } catch (error) {
      if (error instanceof ChronoError && error.code === "store_corrupt") throw error;
      throw new ChronoError("store_corrupt", "Persisted receipt record is invalid.");
    }
  }
  private async publishReceiptIndex(
    record: RunRecord,
    bytes: Uint8Array,
  ): Promise<void> {
    const outcome = await publishNew(
      this.receiptsDir(),
      `${record.receipt.receipt_sha256}.json`,
      bytes,
    );
    if (outcome !== "exists") return;
    const byReceipt = await this.lookupReceipt(record.receipt.receipt_sha256);
    if (byReceipt.request.request_id !== record.request.request_id) {
      throw new ChronoError(
        "store_corrupt",
        "Receipt identity is bound to another request.",
      );
    }
  }
  private async reopenPersistedCase(hash: string): Promise<PrescribedKinematicsCase> {
    const bytes = await this.reopenCase(hash);
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new ChronoError("store_corrupt", "Persisted case is not valid JSON.");
    }
    try {
      return validateCase(raw);
    } catch {
      throw new ChronoError(
        "store_corrupt",
        "Persisted case violates the closed contract.",
      );
    }
  }
  private requireRequestId(requestId: string): void {
    if (!REQUEST_ID.test(requestId)) {
      throw new ChronoError(
        "invalid_request_id",
        "request_id must be 1-128 safe ASCII characters.",
      );
    }
  }
}
