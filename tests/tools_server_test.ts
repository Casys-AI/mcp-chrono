import { assert, assertEquals } from "@std/assert";
import { ChronoService } from "../src/application/service.ts";
import { FileChronoStore } from "../src/application/store.ts";
import { createChronoApp } from "../src/server.ts";
import { MAX_CASE_JSON_BYTES } from "../src/domain/contract.ts";
import { sha256Utf8 } from "../src/domain/sha.ts";
import { caseData, FakeRunner } from "./test-helpers.ts";

const proto = "2026-07-28";
async function start() {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const store = new FileChronoStore(await Deno.makeTempDir());
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
Deno.test("HTTP wire supports modern discover, list and structured tool calls", async () => {
  const { port, http, runner } = await start();
  try {
    const discover = await rpc(port, 1, "server/discover");
    assertEquals(discover.error, undefined);
    assertEquals(discover.result?.supportedVersions, [proto]);
    const list = await rpc(port, 2, "tools/list");
    assertEquals(list.error, undefined);
    assert(
      (list.result?.tools as Array<{ name: string }>).some((tool) =>
        tool.name === "chrono_case_submit"
      ),
    );
    const caseSubmitTool = (list.result?.tools as Array<Record<string, unknown>>).find(
      (tool) => tool.name === "chrono_case_submit",
    )!;
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
      "0.2.0",
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
  } finally {
    await http.shutdown();
  }
});
Deno.test("stdio subprocess answers direct app.start protocol requests", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "server.ts", "--stdio"],
    cwd: new URL("..", import.meta.url).pathname,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": proto,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    }) + "\n",
  ));
  await writer.close();
  const result = await Promise.race([
    child.output(),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch { /* process already stopped */ }
        reject(new Error("stdio response timed out"));
      }, 10_000)
    ),
  ]);
  const stdout = new TextDecoder().decode(result.stdout);
  assert(stdout.includes('"id":1'));
  assert(stdout.includes("supportedVersions"));
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
