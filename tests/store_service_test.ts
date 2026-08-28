import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname } from "node:path";
import { ChronoService } from "../src/application/service.ts";
import { FileChronoStore } from "../src/application/store.ts";
import { sha256Utf8 } from "../src/domain/sha.ts";
import { createRunReceipt, sha256CanonicalJson } from "../src/domain/receipt.ts";
import type { RunRecord } from "../src/domain/types.ts";
import { isAttestedRunRecord } from "../src/domain/types.ts";
import { caseData, FakeRunner, observation } from "./test-helpers.ts";

async function setup() {
  const root = await Deno.makeTempDir();
  const runner = new FakeRunner();
  const service = new ChronoService(new FileChronoStore(root), runner);
  const text = JSON.stringify(caseData());
  return { root, runner, service, sha: await sha256Utf8(text), text };
}

const legacyFixture = new URL("./fixtures/legacy-0.2/", import.meta.url);
async function materializeLegacyFixture(root: string) {
  const caseText = await Deno.readTextFile(new URL("case.json", legacyFixture));
  const recordText = await Deno.readTextFile(new URL("record.json", legacyFixture));
  const record = JSON.parse(recordText) as {
    request: { request_id: string; case_sha256: string };
  };
  assertEquals(await sha256Utf8(caseText), record.request.case_sha256);
  await Deno.mkdir(`${root}/cases`, { recursive: true });
  await Deno.mkdir(`${root}/requests/${record.request.request_id}`, {
    recursive: true,
  });
  await Deno.writeTextFile(
    `${root}/cases/${record.request.case_sha256}.json`,
    caseText,
  );
  await Deno.writeTextFile(
    `${root}/requests/${record.request.request_id}/record.json`,
    recordText,
  );
  return { caseText, recordText, request: record.request };
}

async function captureSyncs(action: () => Promise<void>): Promise<string[]> {
  const synced: string[] = [];
  const opened = new WeakMap<Deno.FsFile, string>();
  const originalOpen = Deno.open;
  const originalSync = Deno.FsFile.prototype.sync;
  Deno.open = async (path, options) => {
    const file = await originalOpen(path, options);
    opened.set(file, String(path));
    return file;
  };
  Deno.FsFile.prototype.sync = async function (): Promise<void> {
    const path = opened.get(this);
    if (path) synced.push(path);
    await originalSync.call(this);
  };
  try {
    await action();
  } finally {
    Deno.open = originalOpen;
    Deno.FsFile.prototype.sync = originalSync;
  }
  return synced;
}
Deno.test("recorded requests are exact idempotent replays and conflicts stay conflicts", async () => {
  const { service, runner, sha, text } = await setup();
  await service.submit(text, sha);
  const first = await service.run({ request_id: "run-1", case_sha256: sha });
  const repeated = await service.run({ request_id: "run-1", case_sha256: sha });
  assertEquals(first.replayed, false);
  assertEquals(repeated.replayed, true);
  assertEquals(runner.calls, 1);
  await assertRejects(
    () => service.run({ request_id: "run-1", case_sha256: "f".repeat(64) }),
    Error,
    "bound to another case",
  );
});
Deno.test("persisted intent stays literal uncertain and does not rerun", async () => {
  const { root, service, runner, sha, text } = await setup();
  await service.submit(text, sha);
  const store = new FileChronoStore(root);
  await store.writeIntent({
    request: { request_id: "uncertain-1", case_sha256: sha },
    case_uri: `chrono-case:sha256:${sha}`,
    intent_recorded_at: "2026-01-01T00:00:00.000Z",
  });
  await assertRejects(
    () => service.run({ request_id: "uncertain-1", case_sha256: sha }),
    Error,
    "will not auto-rerun",
  );
  assertEquals(runner.calls, 0);
  assertEquals((await service.lookup("uncertain-1")).state, "uncertain");
});
Deno.test("a concurrent request id has one native execution owner", async () => {
  const { service, runner, sha, text } = await setup();
  await service.submit(text, sha);
  const results = await Promise.allSettled([
    service.run({ request_id: "concurrent-1", case_sha256: sha }),
    service.run({ request_id: "concurrent-1", case_sha256: sha }),
  ]);
  assertEquals(runner.calls, 1);
  assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
});
Deno.test("an exact 0.2 fixture remains replayable and explicitly unattested", async () => {
  const { root, runner, service } = await setup();
  const { caseText, request } = await materializeLegacyFixture(root);
  const recoveredCase = await service.readCase(request.case_sha256);
  assertEquals(recoveredCase.case_json, caseText);

  const found = await service.lookup(request.request_id);
  assertEquals(found.state, "recorded");
  assert(found.state === "recorded");
  assert(!("receipt" in found.record));
  assertEquals(found.record.output.samples[0].motors[0].motor_angle_rad, undefined);

  const replay = await service.run(request);
  assertEquals(replay.replayed, true);
  assertEquals(runner.calls, 0);
  const view = service.viewRecord(replay.record);
  assert("provenance" in view);
  assertEquals(view.provenance, {
    persistence_format: "legacy-0.2",
    attestation: "unattested",
    receipt: "unavailable",
    unavailable: [
      "receipt_sha256",
      "outcome_sha256",
      "package",
      "provider",
      "worker",
      "runtime",
    ],
  });
  assert(!("runtime" in view.observation));
  assertEquals(view.sample_page.samples[0].motors[0].motor_angle_rad, undefined);
  await assertRejects(() => Deno.stat(`${root}/receipts`), Deno.errors.NotFound);
});
Deno.test("a near-legacy record with invented receipt fields stays corrupt", async () => {
  const { root, service } = await setup();
  const { recordText, request } = await materializeLegacyFixture(root);
  const forged = JSON.parse(recordText) as Record<string, unknown>;
  forged.receipt = {};
  await Deno.writeTextFile(
    `${root}/requests/${request.request_id}/record.json`,
    JSON.stringify(forged),
  );
  await assertRejects(
    () => service.lookup(request.request_id),
    Error,
    "Persisted run record is invalid",
  );
});
Deno.test("an attested 0.3.0 record repairs its receipt index after upgrade", async () => {
  const { root, runner, service, sha, text } = await setup();
  await service.submit(text, sha);
  const request = { request_id: "attested-0.3.0-fixture", case_sha256: sha };
  const recorded_at = "2026-08-28T00:00:00.000Z";
  const output = observation();
  const outcome_sha256 = await sha256CanonicalJson(output);
  const receiptPreimage = {
    schema_id: "chrono-prescribed-kinematics-receipt/1.0" as const,
    case_sha256: sha,
    outcome_sha256,
    request_id: request.request_id,
    recorded_at,
    package: { name: "@casys/mcp-chrono" as const, version: "0.3.0" as const },
    provider: { name: "casys-chrono" as const, version: "0.3.0" as const },
    worker: { source_sha256: "f".repeat(64) },
    runtime: output.runtime,
    execution_state: output.execution_state,
    kinematics_exit: output.kinematics_exit,
  };
  const record: RunRecord = {
    request,
    case_uri: `chrono-case:sha256:${sha}`,
    recorded_at,
    output,
    receipt: {
      ...receiptPreimage,
      receipt_sha256: await sha256CanonicalJson(receiptPreimage),
    },
  };
  await Deno.mkdir(`${root}/requests/${request.request_id}`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/requests/${request.request_id}/record.json`,
    JSON.stringify(record),
  );
  const replay = await service.run(request);
  assertEquals(replay.replayed, true);
  assertEquals(runner.calls, 0);
  assert(isAttestedRunRecord(replay.record));
  assertEquals(replay.record.receipt.package.version, "0.3.0");
  assertEquals(replay.record.receipt.server_runtime, undefined);
  assertEquals(
    (await new FileChronoStore(root).lookupReceipt(record.receipt.receipt_sha256))
      .request.request_id,
    request.request_id,
  );
});
Deno.test("an absent or corrupt case cannot consume a request identity", async () => {
  const { root, service, runner } = await setup();
  const missing = "a".repeat(64);
  await assertRejects(
    () => service.run({ request_id: "missing-case", case_sha256: missing }),
    Error,
    "No stored case",
  );
  assertEquals((await service.lookup("missing-case")).state, "absent");
  await Deno.mkdir(`${root}/cases`, { recursive: true });
  await Deno.writeTextFile(`${root}/cases/${missing}.json`, "corrupt bytes");
  await assertRejects(
    () => service.run({ request_id: "corrupt-case", case_sha256: missing }),
    Error,
    "content address",
  );
  assertEquals((await service.lookup("corrupt-case")).state, "absent");
  assertEquals(runner.calls, 0);
});
Deno.test("partial or malformed ledger JSON is literal store_corrupt", async () => {
  const { root } = await setup();
  await Deno.mkdir(`${root}/requests/partial-intent`, { recursive: true });
  await Deno.writeTextFile(`${root}/requests/partial-intent/intent.json`, "{");
  const store = new FileChronoStore(root);
  await assertRejects(
    () => store.lookup("partial-intent"),
    Error,
    "Ledger JSON is malformed",
  );
  await Deno.mkdir(`${root}/requests/partial-record`, { recursive: true });
  await Deno.writeTextFile(`${root}/requests/partial-record/record.json`, "{");
  await assertRejects(
    () => store.lookup("partial-record"),
    Error,
    "Ledger JSON is malformed",
  );
});
Deno.test("syntactically valid but forged ledger entries are store_corrupt", async () => {
  const { root, service, sha, text } = await setup();
  await service.submit(text, sha);
  await Deno.mkdir(`${root}/requests/forged-intent`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/requests/forged-intent/intent.json`,
    JSON.stringify({
      request: { request_id: "forged-intent" },
      case_uri: "chrono-case:sha256:bad",
      intent_recorded_at: "2026-01-01T00:00:00.000Z",
    }),
  );
  const store = new FileChronoStore(root);
  await assertRejects(
    () => store.lookup("forged-intent"),
    Error,
    "Persisted run intent is invalid",
  );
  await Deno.mkdir(`${root}/requests/forged-record`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/requests/forged-record/record.json`,
    JSON.stringify({
      request: { request_id: "forged-record", case_sha256: sha },
      case_uri: `chrono-case:sha256:${sha}`,
      recorded_at: "2026-01-01T00:00:00.000Z",
      output: {},
    }),
  );
  await assertRejects(
    () => store.lookup("forged-record"),
    Error,
    "Persisted run record is invalid",
  );
});
Deno.test("receipt identity detects a semantically shaped but altered observation", async () => {
  const { root, service, sha, text } = await setup();
  await service.submit(text, sha);
  await service.run({ request_id: "tampered-receipt", case_sha256: sha });
  const path = `${root}/requests/tampered-receipt/record.json`;
  const raw = JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  const samples = (raw.output as Record<string, unknown>).samples as Array<
    Record<string, unknown>
  >;
  const body = (samples[1].bodies as Array<Record<string, unknown>>)[0];
  body.position_m = [7, 0, 0];
  await Deno.writeTextFile(path, JSON.stringify(raw));
  await assertRejects(() => service.lookup("tampered-receipt"), Error, "invalid");
});
Deno.test("store validates a receipt before deriving its immutable index path", async () => {
  const { root, service, sha, text } = await setup();
  await service.submit(text, sha);
  const store = new FileChronoStore(root);
  const request = { request_id: "invalid-receipt-path", case_sha256: sha };
  await store.writeIntent({
    request,
    case_uri: `chrono-case:sha256:${sha}`,
    intent_recorded_at: "2026-01-01T00:00:00.000Z",
  });
  const output = observation();
  const record = {
    request,
    case_uri: `chrono-case:sha256:${sha}`,
    recorded_at: "2026-01-01T00:00:01.000Z",
    output,
    receipt: {
      ...await createRunReceipt(
        sha,
        request,
        "2026-01-01T00:00:01.000Z",
        output,
        { source_sha256: "f".repeat(64) },
      ),
      receipt_sha256: "../escaped",
    },
  } as unknown as RunRecord;
  await assertRejects(() => store.writeRecorded(record), Error, "SHA-256");
  await assertRejects(() => Deno.stat(`${root}/escaped.json`), Deno.errors.NotFound);
});
Deno.test("a recorded request repairs a missing receipt index without rerunning", async () => {
  const { root, service, runner, sha, text } = await setup();
  await service.submit(text, sha);
  const store = new FileChronoStore(root);
  const request = { request_id: "repair-receipt-index", case_sha256: sha };
  await store.writeIntent({
    request,
    case_uri: `chrono-case:sha256:${sha}`,
    intent_recorded_at: "2026-01-01T00:00:00.000Z",
  });
  const output = observation();
  const record: RunRecord = {
    request,
    case_uri: `chrono-case:sha256:${sha}`,
    recorded_at: "2026-01-01T00:00:01.000Z",
    output,
    receipt: await createRunReceipt(
      sha,
      request,
      "2026-01-01T00:00:01.000Z",
      output,
      { source_sha256: "f".repeat(64) },
    ),
  };
  await Deno.writeTextFile(
    `${root}/requests/${request.request_id}/record.json`,
    JSON.stringify(record),
  );
  const recovered = await service.run(request);
  assertEquals(recovered.replayed, true);
  assertEquals(runner.calls, 0);
  assertEquals(
    (await store.lookupReceipt(record.receipt.receipt_sha256)).request.request_id,
    request.request_id,
  );
});
Deno.test("immutable publication is usable with directory sync on macOS and Linux", async () => {
  assert(["darwin", "linux"].includes(Deno.build.os));
  const { root, service, sha, text } = await setup();
  await service.submit(text, sha);
  const store = new FileChronoStore(root);
  await store.writeIntent({
    request: { request_id: "synced-1", case_sha256: sha },
    case_uri: `chrono-case:sha256:${sha}`,
    intent_recorded_at: "2026-01-01T00:00:00.000Z",
  });
  const request = { request_id: "synced-1", case_sha256: sha };
  const recorded_at = "2026-01-01T00:00:01.000Z";
  const output = observation();
  await store.writeRecorded({
    request,
    case_uri: `chrono-case:sha256:${sha}`,
    recorded_at,
    output,
    receipt: await createRunReceipt(
      sha,
      request,
      recorded_at,
      output,
      { source_sha256: "f".repeat(64) },
    ),
  });
  const found = await store.lookup("synced-1");
  assertEquals(found.state, "recorded");
  const names: string[] = [];
  for await (const entry of Deno.readDir(`${root}/requests/synced-1`)) {
    names.push(entry.name);
  }
  assertEquals(names.sort(), ["intent.json", "record.json"]);
  assert(found.state === "recorded");
  assert(isAttestedRunRecord(found.record));
  assert(
    (await store.lookupReceipt(found.record.receipt.receipt_sha256)).request
      .request_id ===
      "synced-1",
  );
});

Deno.test("intent publication syncs each newly created directory before use", async () => {
  const parent = await Deno.makeTempDir();
  const root = `${parent}/chrono-store`;
  const requestDir = `${root}/requests/durable-intent`;
  const synced = await captureSyncs(async () => {
    const store = new FileChronoStore(root);
    await store.writeIntent({
      request: { request_id: "durable-intent", case_sha256: "a".repeat(64) },
      case_uri: `chrono-case:sha256:${"a".repeat(64)}`,
      intent_recorded_at: "2026-01-01T00:00:00.000Z",
    });
  });
  assertEquals(synced.slice(0, 5), [parent, root, root, root, `${root}/requests`]);
  assert(synced[5].startsWith(`${requestDir}/.intent.json.`));
  assertEquals(synced[6], requestDir);
});

Deno.test("an existing store root does not require access to its parent", async () => {
  const root = await Deno.makeTempDir();
  const requestDir = `${root}/requests/preexisting-root`;
  const synced = await captureSyncs(async () => {
    const store = new FileChronoStore(root);
    await store.writeIntent({
      request: { request_id: "preexisting-root", case_sha256: "b".repeat(64) },
      case_uri: `chrono-case:sha256:${"b".repeat(64)}`,
      intent_recorded_at: "2026-01-01T00:00:00.000Z",
    });
  });
  assert(!synced.includes(dirname(root)));
  assertEquals(synced.slice(0, 4), [root, root, root, `${root}/requests`]);
  assert(synced[4].startsWith(`${requestDir}/.intent.json.`));
  assertEquals(synced[5], requestDir);
});
