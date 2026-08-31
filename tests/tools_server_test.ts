import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ChronoService } from "../src/application/service.ts";
import { FileChronoStore } from "../src/application/store.ts";
import { createChronoApp } from "../src/server.ts";
import { MAX_CASE_JSON_BYTES } from "../src/domain/contract.ts";
import { PROVIDER_VERSION } from "../src/domain/types.ts";
import { sha256Utf8 } from "../src/domain/sha.ts";
import {
  CHRONO_RESULT_SCHEMA_IDS,
  CHRONO_RUN_RECORD_VIEWER_URI,
  CHRONO_VIEW_APP_MANIFEST,
  CHRONO_VIEW_APP_MANIFEST_JSON,
  CHRONO_VIEW_APP_MANIFEST_URI,
} from "../src/ui/app-contract.ts";
import { caseData, FakeRunner } from "./test-helpers.ts";

const proto = "2026-07-28";
const legacyProto = "2025-06-18";
const providerInstructions =
  "Explicit Project Chrono 10.0.0 prescribed rigid-body kinematics only. " +
  "This provider reports factual observations and never decides product fitness.";
const serverInfo = { name: "casys-chrono", version: PROVIDER_VERSION };

interface StdioResponse {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: Record<string, unknown>;
}

async function start(storeRoot?: string) {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const store = new FileChronoStore(storeRoot ?? await Deno.makeTempDir());
  const runner = new FakeRunner();
  const app = createChronoApp(new ChronoService(store, runner));
  return {
    port,
    runner,
    store,
    http: await app.startHttp({
      port,
      hostname: "127.0.0.1",
      cors: false,
      onListen: () => {},
    }),
  };
}

async function materializeLegacyFixture(root: string): Promise<{
  case_json: string;
  case_sha256: string;
  request_id: string;
}> {
  const fixture = new URL("./fixtures/legacy-0.2/", import.meta.url);
  const case_json = await Deno.readTextFile(new URL("case.json", fixture));
  const record = JSON.parse(
    await Deno.readTextFile(new URL("record.json", fixture)),
  ) as { request: { request_id: string } };
  const case_sha256 = await sha256Utf8(case_json);
  await Deno.mkdir(`${root}/cases`, { recursive: true });
  await Deno.mkdir(`${root}/requests/${record.request.request_id}`, {
    recursive: true,
  });
  await Deno.writeTextFile(`${root}/cases/${case_sha256}.json`, case_json);
  await Deno.writeTextFile(
    `${root}/requests/${record.request.request_id}/record.json`,
    JSON.stringify(record),
  );
  return { case_json, case_sha256, request_id: record.request.request_id };
}
async function rpc(
  port: number,
  id: number,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "MCP-Protocol-Version": proto,
      "Mcp-Method": method,
      ...(method === "tools/call" ? { "Mcp-Name": params.name as string } : {}),
      ...(method === "resources/read" ? { "Mcp-Name": params.uri as string } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": proto,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    }),
  });
  return await response.json() as Record<string, Record<string, unknown>>;
}

function modernStdioRequest(
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": proto,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "stdio-test", version: "1" },
      },
    },
  };
}

async function exchangeStdio(
  requests: ReadonlyArray<Record<string, unknown>>,
  existingStoreRoot?: string,
): Promise<Map<number, StdioResponse>> {
  const storeRoot = existingStoreRoot ?? await Deno.makeTempDir();
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "server.ts", "--stdio"],
    cwd: new URL("..", import.meta.url).pathname,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env: { CHRONO_STORE_DIR: storeRoot },
  }).spawn();
  const writer = child.stdin.getWriter();
  try {
    for (const request of requests) {
      await writer.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    }
  } finally {
    await writer.close();
  }
  try {
    const result = await Promise.race([
      child.output(),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch { /* process already stopped */ }
          reject(new Error("stdio subprocess response timed out"));
        }, 10_000)
      ),
    ]);
    const decoder = new TextDecoder();
    assert(result.success, decoder.decode(result.stderr));

    const responses = new Map<number, StdioResponse>();
    for (const line of decoder.decode(result.stdout).split("\n")) {
      if (line.trim().length === 0) continue;
      const response = JSON.parse(line) as StdioResponse;
      if (typeof response.id === "number") responses.set(response.id, response);
    }
    return responses;
  } finally {
    if (existingStoreRoot === undefined) {
      await Deno.remove(storeRoot, { recursive: true });
    }
  }
}

Deno.test("HTTP wire supports modern discover, list and structured tool calls", async () => {
  const { port, http, runner } = await start();
  try {
    const discover = await rpc(port, 1, "server/discover");
    assertEquals(discover.error, undefined);
    assertEquals(discover.result?.supportedVersions, [proto]);
    const list = await rpc(port, 2, "tools/list");
    assertEquals(list.error, undefined);
    const tools = list.result?.tools as Array<Record<string, unknown>>;
    assert(tools.some((tool) => tool.name === "chrono_case_submit"));
    const caseSubmitTool = tools.find((tool) => tool.name === "chrono_case_submit")!;
    assertEquals(caseSubmitTool._meta, undefined);
    assertEquals(
      (tools.find((tool) => tool.name === "chrono_manifest_get")?._meta) ?? undefined,
      undefined,
    );
    const runRecordUri = CHRONO_RUN_RECORD_VIEWER_URI;
    const resultSchemas = new Map([
      [
        "chrono_run_prescribed_kinematics",
        CHRONO_RESULT_SCHEMA_IDS.prescribedRun,
      ],
      ["chrono_run_get", CHRONO_RESULT_SCHEMA_IDS.recordedLookup],
      ["chrono_run_receipt_get", CHRONO_RESULT_SCHEMA_IDS.receiptLookup],
    ]);
    for (const [name, resultSchema] of resultSchemas) {
      const tool = tools.find((entry) => entry.name === name);
      assert(tool, name);
      assertEquals(
        ((tool._meta as Record<string, unknown>).ui as Record<string, unknown>)
          .resourceUri,
        runRecordUri,
      );
      assertEquals(
        (tool.outputSchema as Record<string, unknown>).$id,
        resultSchema,
      );
    }
    const resources = await rpc(port, 21, "resources/list");
    assertEquals(resources.error, undefined);
    const listed = resources.result?.resources as Array<Record<string, unknown>>;
    assertEquals(listed.length, 2);
    assert(
      listed.some((entry) =>
        entry.uri === runRecordUri &&
        entry.mimeType === "text/html;profile=mcp-app"
      ),
    );
    assert(
      listed.some((entry) =>
        entry.uri === CHRONO_VIEW_APP_MANIFEST_URI &&
        entry.mimeType === "application/json"
      ),
    );
    const resource = await rpc(port, 22, "resources/read", { uri: runRecordUri });
    assertEquals(resource.error, undefined);
    const html = ((resource.result?.contents as Array<Record<string, unknown>>)[0]
      ?.text) as string;
    assertStringIncludes(html, "<!doctype html>");
    assertStringIncludes(html, "chrono.recorded-run");
    const appManifestResource = await rpc(port, 23, "resources/read", {
      uri: CHRONO_VIEW_APP_MANIFEST_URI,
    });
    assertEquals(appManifestResource.error, undefined);
    const appManifestText = ((appManifestResource.result?.contents as Array<
      Record<string, unknown>
    >)[0]?.text) as string;
    assertEquals(appManifestText, CHRONO_VIEW_APP_MANIFEST_JSON);
    assertEquals(JSON.parse(appManifestText), CHRONO_VIEW_APP_MANIFEST);
    assertEquals(
      (caseSubmitTool.inputSchema as Record<string, unknown>).required,
      ["case_json"],
    );
    assertEquals(
      ((caseSubmitTool.inputSchema as Record<string, unknown>).properties as Record<
        string,
        Record<string, unknown>
      >).case_json.maxLength,
      MAX_CASE_JSON_BYTES,
    );
    const manifest = await rpc(port, 3, "tools/call", {
      name: "chrono_manifest_get",
      arguments: {},
    });
    const manifestContent = manifest.result?.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(manifestContent.ok, true);
    assertEquals(
      (manifestContent.manifest as Record<string, unknown>).version,
      PROVIDER_VERSION,
    );
    assertEquals(
      (manifestContent.manifest as Record<string, unknown>).input_pose_semantics,
      "absolute_com_pose and absolute_joint_frame are absolute zero-angle references; t=0 is observed after assembly applies initial_angle_rad and may differ.",
    );
    const caseContract = (manifestContent.manifest as Record<string, unknown>)
      .case_contract as Record<string, unknown>;
    assertEquals(
      (caseContract.json_schema as Record<string, unknown>).$id,
      "chrono-prescribed-kinematics-case/1.0",
    );
    assertEquals(
      ((caseContract.example_case as Record<string, unknown>).units as Record<
        string,
        unknown
      >).length,
      "m",
    );
    assertEquals(
      ((manifestContent.manifest as Record<string, unknown>).result_paging as Record<
        string,
        unknown
      >).default_sample_limit,
      16,
    );
    const template = await rpc(port, 4, "tools/call", {
      name: "chrono_case_template_get",
      arguments: {},
    });
    assertEquals(
      (template.result?.structuredContent as Record<string, unknown>).case_schema_id,
      "chrono-prescribed-kinematics-case/1.0",
    );
    const text = JSON.stringify(caseData());
    const sha = await sha256Utf8(text);
    const submitted = await rpc(port, 5, "tools/call", {
      name: "chrono_case_submit",
      arguments: { case_json: text },
    });
    assertEquals(
      (submitted.result?.structuredContent as Record<string, unknown>).case_uri,
      `chrono-case:sha256:${sha}`,
    );
    assertEquals(
      (submitted.result?.structuredContent as Record<string, unknown>).case_sha256,
      sha,
    );
    const caseReadback = await rpc(port, 6, "tools/call", {
      name: "chrono_case_get",
      arguments: { case_sha256: sha },
    });
    assertEquals(
      (caseReadback.result?.structuredContent as Record<string, unknown>).case_json,
      text,
    );
    const rejected = await rpc(port, 6, "tools/call", {
      name: "chrono_case_submit",
      arguments: { case_json: text, case_sha256: "0".repeat(64) },
    });
    assertEquals(rejected.result?.isError, true);
    assertEquals(
      ((rejected.result?.structuredContent as Record<string, unknown>).error as Record<
        string,
        unknown
      >).code,
      "case_sha256_mismatch",
    );
    assertEquals(
      (((rejected.result?.structuredContent as Record<string, unknown>).error as Record<
        string,
        unknown
      >).details as Record<string, unknown>).actual_case_sha256,
      sha,
    );
    const callsBeforeInvalidPage = runner.calls;
    const invalidPage = await rpc(port, 7, "tools/call", {
      name: "chrono_run_prescribed_kinematics",
      arguments: {
        request_id: "wire-invalid-page",
        case_sha256: sha,
        sample_limit: 65,
      },
    });
    assertEquals(invalidPage.result?.isError, true);
    assertEquals(
      ((invalidPage.result?.structuredContent as Record<string, unknown>)
        .error as Record<
          string,
          unknown
        >).code,
      "invalid_sample_limit",
    );
    assertEquals(runner.calls, callsBeforeInvalidPage);
    const absentAfterInvalidPage = await rpc(port, 8, "tools/call", {
      name: "chrono_run_get",
      arguments: { request_id: "wire-invalid-page" },
    });
    assertEquals(
      (absentAfterInvalidPage.result?.structuredContent as Record<string, unknown>)
        .state,
      "absent",
    );
    const ran = await rpc(port, 7, "tools/call", {
      name: "chrono_run_prescribed_kinematics",
      arguments: {
        request_id: "wire-paged",
        case_sha256: sha,
        sample_limit: 1,
      },
    });
    const record = (ran.result?.structuredContent as Record<string, unknown>)
      .record as Record<string, unknown>;
    assertEquals((record.observation as Record<string, unknown>).sample_count, 2);
    assertEquals(
      ((record.sample_page as Record<string, unknown>).samples as unknown[]).length,
      1,
    );
    assertEquals((record.sample_page as Record<string, unknown>).has_more, true);
    const receipt = record.receipt as Record<string, unknown>;
    assertEquals(receipt.case_sha256, sha);
    assertEquals((receipt.outcome_sha256 as string).length, 64);
    assertEquals((receipt.receipt_sha256 as string).length, 64);
    assertEquals(receipt.package, {
      name: "@casys/mcp-chrono",
      version: PROVIDER_VERSION,
    });
    assertEquals(receipt.server_runtime, { deno_version: Deno.version.deno });
    assertEquals((record.observation as Record<string, unknown>).runtime, {
      binding: "pychrono",
      python_version: "3.12.0",
    });
    const secondPage = await rpc(port, 10, "tools/call", {
      name: "chrono_run_get",
      arguments: { request_id: "wire-paged", sample_offset: 1, sample_limit: 1 },
    });
    const secondRecord =
      (secondPage.result?.structuredContent as Record<string, unknown>)
        .record as Record<string, unknown>;
    const page = secondRecord.sample_page as Record<string, unknown>;
    assertEquals(page.has_more, false);
    assertEquals(
      (page.samples as Array<Record<string, unknown>>)[0].time_s,
      1,
    );
    const receiptReadback = await rpc(port, 11, "tools/call", {
      name: "chrono_run_receipt_get",
      arguments: { receipt_sha256: receipt.receipt_sha256 as string, sample_limit: 1 },
    });
    const receiptRecord =
      (receiptReadback.result?.structuredContent as Record<string, unknown>)
        .record as Record<string, unknown>;
    assertEquals(receiptRecord.receipt, receipt);
    assertEquals((receiptRecord.sample_page as Record<string, unknown>).has_more, true);
  } finally {
    await http.shutdown();
  }
});
Deno.test("HTTP readback fails closed on an exact 0.2 durable record", async () => {
  const storeRoot = await Deno.makeTempDir();
  const fixture = await materializeLegacyFixture(storeRoot);
  const originalRecord = await Deno.readTextFile(
    `${storeRoot}/requests/${fixture.request_id}/record.json`,
  );
  const { port, http, runner } = await start(storeRoot);
  try {
    const caseReadback = await rpc(port, 1, "tools/call", {
      name: "chrono_case_get",
      arguments: { case_sha256: fixture.case_sha256 },
    });
    assertEquals(
      (caseReadback.result?.structuredContent as Record<string, unknown>).case_json,
      fixture.case_json,
    );
    const lookup = await rpc(port, 2, "tools/call", {
      name: "chrono_run_get",
      arguments: { request_id: fixture.request_id },
    });
    assertEquals(lookup.result?.isError, true);
    assertEquals(
      ((lookup.result?.structuredContent as Record<string, unknown>).error as Record<
        string,
        unknown
      >).code,
      "store_corrupt",
    );
    const replay = await rpc(port, 3, "tools/call", {
      name: "chrono_run_prescribed_kinematics",
      arguments: {
        request_id: fixture.request_id,
        case_sha256: fixture.case_sha256,
      },
    });
    assertEquals(replay.result?.isError, true);
    assertEquals(
      ((replay.result?.structuredContent as Record<string, unknown>).error as Record<
        string,
        unknown
      >).code,
      "store_corrupt",
    );
    assertEquals(runner.calls, 0);
    assertEquals(
      await Deno.readTextFile(
        `${storeRoot}/requests/${fixture.request_id}/record.json`,
      ),
      originalRecord,
    );
  } finally {
    await http.shutdown();
    await Deno.remove(storeRoot, { recursive: true });
  }
});
Deno.test("stdio subprocess returns a structured modern discovery identity", async () => {
  const responses = await exchangeStdio([
    modernStdioRequest(1, "server/discover"),
  ]);
  const discover = responses.get(1);
  assert(discover, "stdio server/discover did not return a response");
  assertEquals(discover.error, undefined);
  assertEquals(discover.result, {
    supportedVersions: [proto],
    capabilities: { tools: {}, resources: { listChanged: true } },
    instructions: providerInstructions,
    resultType: "complete",
    ttlMs: 0,
    cacheScope: "private",
    _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
  });
});

Deno.test("stdio subprocess supports legacy initialization and a manifest call", async () => {
  const responses = await exchangeStdio([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: legacyProto,
        capabilities: {},
        clientInfo: { name: "legacy-stdio-test", version: "1" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "chrono_manifest_get", arguments: {} },
    },
  ]);
  const initialized = responses.get(1);
  assert(initialized, "stdio initialize did not return a response");
  assertEquals(initialized.error, undefined);
  assertEquals(initialized.result, {
    protocolVersion: legacyProto,
    capabilities: { tools: {}, resources: { listChanged: true } },
    serverInfo,
    instructions: providerInstructions,
  });

  const manifest = responses.get(2);
  assert(manifest, "stdio chrono_manifest_get did not return a response");
  assertEquals(manifest.error, undefined);
  const structured = manifest.result?.structuredContent as Record<string, unknown>;
  assertEquals(structured.ok, true);
  const manifestPayload = structured.manifest as Record<string, unknown>;
  assertEquals(manifestPayload.name, "@casys/mcp-chrono");
  assertEquals(manifestPayload.version, PROVIDER_VERSION);
  assertEquals(
    manifestPayload.case_schema_id,
    "chrono-prescribed-kinematics-case/1.0",
  );
});

Deno.test("stdio subprocess stores and rereads exact case bytes", async () => {
  const text = JSON.stringify(caseData());
  const sha = await sha256Utf8(text);
  const responses = await exchangeStdio([
    modernStdioRequest(1, "tools/call", {
      name: "chrono_case_submit",
      arguments: { case_json: text, case_sha256: sha },
    }),
    modernStdioRequest(2, "tools/call", {
      name: "chrono_case_get",
      arguments: { case_sha256: sha },
    }),
    modernStdioRequest(3, "tools/call", {
      name: "chrono_run_receipt_get",
      arguments: { receipt_sha256: "f".repeat(64) },
    }),
  ]);
  const submitted = responses.get(1)?.result?.structuredContent as Record<
    string,
    unknown
  >;
  assertEquals(submitted.case_sha256, sha);
  const readback = responses.get(2)?.result?.structuredContent as Record<
    string,
    unknown
  >;
  assertEquals(readback.case_json, text);
  const missingReceipt = responses.get(3)?.result?.structuredContent as Record<
    string,
    unknown
  >;
  assertEquals(missingReceipt.ok, false);
  assertEquals(
    (missingReceipt.error as Record<string, unknown>).code,
    "receipt_not_found",
  );
});

Deno.test("stdio readback fails closed on an exact 0.2 durable record", async () => {
  const storeRoot = await Deno.makeTempDir();
  const fixture = await materializeLegacyFixture(storeRoot);
  const originalRecord = await Deno.readTextFile(
    `${storeRoot}/requests/${fixture.request_id}/record.json`,
  );
  try {
    const responses = await exchangeStdio([
      modernStdioRequest(1, "tools/call", {
        name: "chrono_case_get",
        arguments: { case_sha256: fixture.case_sha256 },
      }),
      modernStdioRequest(2, "tools/call", {
        name: "chrono_run_get",
        arguments: { request_id: fixture.request_id },
      }),
      modernStdioRequest(3, "tools/call", {
        name: "chrono_run_prescribed_kinematics",
        arguments: {
          request_id: fixture.request_id,
          case_sha256: fixture.case_sha256,
        },
      }),
    ], storeRoot);
    const caseReadback = responses.get(1)?.result?.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(caseReadback.case_json, fixture.case_json);
    const lookup = responses.get(2)?.result?.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(lookup.ok, false);
    assertEquals((lookup.error as Record<string, unknown>).code, "store_corrupt");
    const replay = responses.get(3)?.result?.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(replay.ok, false);
    assertEquals((replay.error as Record<string, unknown>).code, "store_corrupt");
    assertEquals(
      await Deno.readTextFile(
        `${storeRoot}/requests/${fixture.request_id}/record.json`,
      ),
      originalRecord,
    );
  } finally {
    await Deno.remove(storeRoot, { recursive: true });
  }
});

Deno.test("native CLI rejects mixed and unknown transport arguments", async () => {
  for (
    const args of [
      ["--stdio", "--port", "3025"],
      ["--stdio", "--unknown"],
      ["--unknown"],
    ]
  ) {
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "server.ts", ...args],
      cwd: new URL("..", import.meta.url).pathname,
    }).output();
    assertEquals(result.success, false);
    assertStringIncludes(
      new TextDecoder().decode(result.stderr),
      "Invalid CLI arguments: expected no arguments for HTTP or exactly --stdio for stdio",
    );
  }
});
Deno.test("non-loopback HTTP refuses to start without static bearer configuration", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "server.ts"],
    cwd: new URL("..", import.meta.url).pathname,
    env: { HOST: "0.0.0.0", PORT: "3025" },
  }).output();
  assertEquals(result.success, false);
  assert(new TextDecoder().decode(result.stderr).includes("MCP_AUTH_TOKENS"));
});
