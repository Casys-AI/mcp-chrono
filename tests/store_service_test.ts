import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname } from "node:path";
import { ChronoService } from "../src/application/service.ts";
import { FileChronoStore } from "../src/application/store.ts";
import { sha256Utf8 } from "../src/domain/sha.ts";
import { caseData, FakeRunner, observation } from "./test-helpers.ts";

async function setup() {
  const root = await Deno.makeTempDir();
  const runner = new FakeRunner();
  const service = new ChronoService(new FileChronoStore(root), runner);
  const text = JSON.stringify(caseData());
  return { root, runner, service, sha: await sha256Utf8(text), text };
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
  await store.writeRecorded({
    request: { request_id: "synced-1", case_sha256: sha },
    case_uri: `chrono-case:sha256:${sha}`,
    recorded_at: "2026-01-01T00:00:01.000Z",
    output: observation(),
  });
  assertEquals((await store.lookup("synced-1")).state, "recorded");
  const names: string[] = [];
  for await (const entry of Deno.readDir(`${root}/requests/synced-1`)) {
    names.push(entry.name);
  }
  assertEquals(names.sort(), ["intent.json", "record.json"]);
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
  assertEquals(synced.slice(0, 4), [parent, root, root, `${root}/requests`]);
  assert(synced[4].startsWith(`${requestDir}/.intent.json.`));
  assertEquals(synced[5], requestDir);
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
  assertEquals(synced.slice(0, 3), [root, root, `${root}/requests`]);
  assert(synced[3].startsWith(`${requestDir}/.intent.json.`));
  assertEquals(synced[4], requestDir);
});
