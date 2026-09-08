import { assert, assertEquals } from "@std/assert";
import { ChronoService } from "../src/application/service.ts";
import { FileChronoStore } from "../src/application/store.ts";
import { createChronoApp } from "../src/server.ts";
import { sha256Utf8 } from "../src/domain/sha.ts";
import type { RunObservation } from "../src/domain/types.ts";
import { FakeRunner, oneJointCase, workerObservation } from "./test-helpers.ts";

const proto = "2026-07-28";

interface StdioResponse {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: Record<string, unknown>;
}

function injectedNotConvergedObservation(): RunObservation {
  const payload = workerObservation(oneJointCase());
  payload.execution_state = "not_converged";
  payload.kinematics_exit = { raw_code: 0, raw_name: "NOT_CONVERGED" };
  payload.samples = (payload.samples as unknown[]).slice(0, 1);
  return payload as unknown as RunObservation;
}

async function startHttp(observation: RunObservation) {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const storeRoot = await Deno.makeTempDir();
  const app = createChronoApp(
    new ChronoService(new FileChronoStore(storeRoot), new FakeRunner(observation)),
  );
  return {
    port,
    storeRoot,
    http: await app.startHttp({
      port,
      hostname: "127.0.0.1",
      cors: false,
      onListen: () => {},
    }),
  };
}

async function httpRpc(
  port: number,
  id: number,
  toolName: string,
  arguments_: Record<string, unknown>,
) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "MCP-Protocol-Version": proto,
      "Mcp-Method": "tools/call",
      "Mcp-Name": toolName,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: arguments_,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": proto,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "non-native-not-converged-http",
            version: "1",
          },
        },
      },
    }),
  });
  return await response.json() as Record<string, Record<string, unknown>>;
}

function modernStdioRequest(
  id: number,
  toolName: string,
  arguments_: Record<string, unknown>,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: arguments_,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": proto,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": {
          name: "non-native-not-converged-stdio",
          version: "1",
        },
      },
    },
  };
}

async function exchangeInjectedStdio(
  observation: RunObservation,
  requests: ReadonlyArray<Record<string, unknown>>,
  storeRoot: string,
): Promise<Map<number, StdioResponse>> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tests/non_native_injected_runner_server.ts"],
    cwd: new URL("..", import.meta.url).pathname,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env: {
      CHRONO_STORE_DIR: storeRoot,
      CHRONO_INJECTED_OBSERVATION: JSON.stringify(observation),
    },
  }).spawn();
  const writer = child.stdin.getWriter();
  try {
    for (const request of requests) {
      await writer.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    }
  } finally {
    await writer.close();
  }
  const result = await Promise.race([
    child.output(),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch { /* process already stopped */ }
        reject(new Error("non-native stdio subprocess response timed out"));
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
}

function assertNotConvergedRecord(
  structured: Record<string, unknown>,
  caseSha256: string,
  caseJson: string,
) {
  assertEquals(structured.ok, true);
  const record = structured.record as Record<string, unknown>;
  const observation = record.observation as Record<string, unknown>;
  assertEquals(observation.execution_state, "not_converged");
  assertEquals(observation.kinematics_exit, {
    raw_code: 0,
    raw_name: "NOT_CONVERGED",
  });
  assertEquals(observation.not_evaluated, [
    "collision",
    "clearance",
    "contact",
    "forces",
    "torques",
    "dynamics",
    "strength",
    "safety",
    "product fitness",
  ]);
  const receipt = record.receipt as Record<string, unknown>;
  assertEquals(receipt.case_sha256, caseSha256);
  assertEquals(receipt.execution_state, "not_converged");
  assertEquals(receipt.kinematics_exit, observation.kinematics_exit);
  assertEquals(typeof caseJson, "string");
}

Deno.test("non-native injected NOT_CONVERGED is stored and reread over HTTP", async () => {
  const observation = injectedNotConvergedObservation();
  const { port, http, storeRoot } = await startHttp(observation);
  try {
    const caseJson = JSON.stringify(oneJointCase());
    const caseSha256 = await sha256Utf8(caseJson);
    const submitted = await httpRpc(port, 1, "chrono_case_submit", {
      case_json: caseJson,
      case_sha256: caseSha256,
    });
    const submittedContent = submitted.result as Record<string, unknown>;
    const submittedStructured = submittedContent.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(submittedStructured.ok, true);
    const caseReadback = await httpRpc(port, 2, "chrono_case_get", {
      case_sha256: caseSha256,
    });
    const caseStructured = (caseReadback.result as Record<string, unknown>)
      .structuredContent as Record<string, unknown>;
    assertEquals(caseStructured.case_json, caseJson);
    const run = await httpRpc(port, 3, "chrono_run_prescribed_kinematics", {
      request_id: "non-native-not-converged-http",
      case_sha256: caseSha256,
      case_uri: submittedStructured.case_uri,
    });
    const runStructured = (run.result as Record<string, unknown>)
      .structuredContent as Record<string, unknown>;
    assertNotConvergedRecord(runStructured, caseSha256, caseJson);
    const receipt = (runStructured.record as Record<string, unknown>).receipt as Record<
      string,
      unknown
    >;
    const receiptReadback = await httpRpc(port, 4, "chrono_run_receipt_get", {
      receipt_sha256: receipt.receipt_sha256,
    });
    const receiptStructured = (receiptReadback.result as Record<string, unknown>)
      .structuredContent as Record<string, unknown>;
    assertEquals(receiptStructured.ok, true);
    assertEquals(receiptStructured.record, runStructured.record);
  } finally {
    await http.shutdown();
    await Deno.remove(storeRoot, { recursive: true });
  }
});

Deno.test("non-native injected NOT_CONVERGED is stored and reread over stdio", async () => {
  const observation = injectedNotConvergedObservation();
  const caseJson = JSON.stringify(oneJointCase());
  const caseSha256 = await sha256Utf8(caseJson);
  const storeRoot = await Deno.makeTempDir();
  try {
    const responses = await exchangeInjectedStdio(observation, [
      modernStdioRequest(1, "chrono_case_submit", {
        case_json: caseJson,
        case_sha256: caseSha256,
      }),
      modernStdioRequest(2, "chrono_case_get", { case_sha256: caseSha256 }),
      modernStdioRequest(3, "chrono_run_prescribed_kinematics", {
        request_id: "non-native-not-converged-stdio",
        case_sha256: caseSha256,
      }),
    ], storeRoot);
    const submitted = responses.get(1)?.result?.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(submitted.ok, true);
    const caseReadback = responses.get(2)?.result?.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(caseReadback.case_json, caseJson);
    const run = responses.get(3)?.result?.structuredContent as Record<string, unknown>;
    assertNotConvergedRecord(run, caseSha256, caseJson);
    const receipt = (run.record as Record<string, unknown>).receipt as Record<
      string,
      unknown
    >;
    const reread = await exchangeInjectedStdio(observation, [
      modernStdioRequest(4, "chrono_case_get", { case_sha256: caseSha256 }),
      modernStdioRequest(5, "chrono_run_get", {
        request_id: "non-native-not-converged-stdio",
      }),
      modernStdioRequest(6, "chrono_run_receipt_get", {
        receipt_sha256: receipt.receipt_sha256,
      }),
    ], storeRoot);
    const exactCase = reread.get(4)?.result?.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(exactCase.case_json, caseJson);
    const runReadback = reread.get(5)?.result?.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(runReadback.state, "recorded");
    assertEquals(runReadback.record, run.record);
    const receiptReadback = reread.get(6)?.result?.structuredContent as Record<
      string,
      unknown
    >;
    assertEquals(receiptReadback.ok, true);
    assertEquals(receiptReadback.record, run.record);
  } finally {
    await Deno.remove(storeRoot, { recursive: true });
  }
});
