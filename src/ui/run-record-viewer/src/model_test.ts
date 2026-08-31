import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  advertisedComponentCatalog,
  CASYS_SURFACE_CONTEXT_KEY,
  mountComponentSurface,
} from "@casys/mcp-view-components";
import type { PreactSurfaceContext } from "@casys/mcp-view-components/preact";
import { PROVIDER_VERSION } from "../../../domain/types.ts";
import {
  CHRONO_VIEW_APP_MANIFEST,
  CHRONO_VIEW_APP_MANIFEST_JSON,
  CHRONO_VIEWER_SESSION_SCHEMA,
  VIEWER_SESSION_APPLY_ACTION,
} from "../../app-contract.ts";
import {
  chronoOutcomeFingerprint,
  chronoReceiptFingerprint,
  chronoReceiptIdentityUri,
  chronoRecordedSessionFingerprint,
  parseChronoViewerSession,
} from "../../../viewer-session.ts";
import { CHRONO_APP_INFO, renderDisplayState, resolveChronoSurface } from "./app.ts";
import {
  CHRONO_COMPONENT_KEYS,
  CHRONO_COMPONENT_REGISTRY,
  CHRONO_RUN_RECORD_SURFACE,
} from "./components.tsx";
import {
  type ChronoDurableRunRecord,
  type ChronoRunRecordView,
  type ChronoRunView,
  chronoRunViewFromDurableRecord,
  displayStateFromToolResult,
  formatExactNumber,
  parseChronoRunView,
  toolErrorMessage,
} from "./model.ts";
import { createBufferedSessionReceiver } from "./session-receiver.ts";

const CASE_SHA = "a".repeat(64);
const RECEIPT_SHA = "b".repeat(64);
const OUTCOME_SHA = "c".repeat(64);
const WORKER_SHA = "d".repeat(64);

const recorded: ChronoRunRecordView = {
  request: { request_id: "wire-paged", case_sha256: CASE_SHA },
  case_uri: `chrono-case:sha256:${CASE_SHA}`,
  recorded_at: "2026-08-28T00:00:00.000Z",
  receipt: {
    schema_id: "chrono-prescribed-kinematics-receipt/1.0",
    receipt_sha256: RECEIPT_SHA,
    case_sha256: CASE_SHA,
    outcome_sha256: OUTCOME_SHA,
    request_id: "wire-paged",
    recorded_at: "2026-08-28T00:00:00.000Z",
    package: { name: "@casys/mcp-chrono", version: PROVIDER_VERSION },
    provider: { name: "casys-chrono", version: PROVIDER_VERSION },
    worker: { source_sha256: WORKER_SHA },
    runtime: { binding: "pychrono", python_version: "3.12.0" },
    server_runtime: { deno_version: "2.9.6" },
    execution_state: "completed",
    kinematics_exit: { raw_code: 1, raw_name: "SUCCESS" },
  },
  observation: {
    engine: { name: "Project Chrono", version: "10.0.0" },
    runtime: { binding: "pychrono", python_version: "3.12.0" },
    execution_state: "completed",
    kinematics_exit: { raw_code: 1, raw_name: "SUCCESS" },
    not_evaluated: [
      "collision",
      "clearance",
      "contact",
      "forces",
      "torques",
      "dynamics",
      "strength",
      "safety",
      "product fitness",
    ],
    sample_count: 2,
    sample_time_range_s: { first: 0, last: 0.9999999999999999 },
  },
  sample_page: {
    offset: 0,
    limit: 16,
    total: 2,
    returned: 2,
    has_more: false,
    samples: [
      {
        time_s: 0,
        bodies: [{
          id: "root",
          position_m: [0, 0, 0],
          rotation_wxyz: [1, 0, 0, 0],
        }],
        motors: [],
      },
      {
        time_s: 0.9999999999999999,
        bodies: [{
          id: "root",
          position_m: [0, 0, 0],
          rotation_wxyz: [1, 0, 0, 0],
        }],
        motors: [{
          joint_id: "hinge",
          motor_angle_rad: 0.5,
          declared_limit_observation: "within",
          translation_residual_m: [0, 0, 0],
          rotation_quaternion_imag_residual: [0, 0, 0],
        }],
      },
    ],
  },
};

const runResult = { ok: true, replayed: false, record: recorded };
const runGetRecorded = { ok: true, state: "recorded", record: recorded };
const receiptGet = { ok: true, record: recorded };
const uncertain = {
  ok: true,
  state: "uncertain",
  intent: {
    request: { request_id: "open-intent", case_sha256: CASE_SHA },
    case_uri: `chrono-case:sha256:${CASE_SHA}`,
    intent_recorded_at: "2026-08-28T00:00:00.000Z",
  },
};
const absent = { ok: true, state: "absent" };
const componentContext = {} as unknown as PreactSurfaceContext<ChronoRunView>;

async function durableRecordFixture(): Promise<ChronoDurableRunRecord> {
  const output = {
    engine: recorded.observation.engine,
    runtime: recorded.observation.runtime,
    samples: structuredClone(recorded.sample_page.samples),
    not_evaluated: recorded.observation.not_evaluated,
    execution_state: recorded.observation.execution_state,
    kinematics_exit: recorded.observation.kinematics_exit,
  };
  const outcomeFingerprint = await chronoOutcomeFingerprint(output);
  const receiptSeed = {
    ...recorded.receipt,
    receipt_sha256: "0".repeat(64),
    outcome_sha256: outcomeFingerprint.slice("sha256:".length),
  };
  const receiptFingerprint = await chronoReceiptFingerprint(receiptSeed);
  return {
    request: recorded.request,
    case_uri: recorded.case_uri,
    recorded_at: recorded.recorded_at,
    output,
    receipt: {
      ...receiptSeed,
      receipt_sha256: receiptFingerprint.slice("sha256:".length),
    },
  };
}

async function viewerSessionFixture() {
  const record = await durableRecordFixture();
  const receiptFingerprint = "sha256:" + record.receipt.receipt_sha256;
  const session = {
    schemaVersion: CHRONO_VIEWER_SESSION_SCHEMA,
    kind: "chrono.recorded-run",
    basis: { sessionFingerprint: "sha256:" + "0".repeat(64) },
    anchor: {
      kind: "chrono-recorded-run",
      id: record.request.request_id,
      uri: chronoReceiptIdentityUri(record.receipt.receipt_sha256),
      fingerprint: receiptFingerprint,
    },
    provenance: {
      kind: "mcp-chrono-recorded-run",
      server: { package: "@casys/mcp-chrono", version: PROVIDER_VERSION },
      requestId: record.request.request_id,
      caseArtifact: {
        uri: record.case_uri,
        fingerprint: "sha256:" + record.request.case_sha256,
      },
      outcomeFingerprint: "sha256:" + record.receipt.outcome_sha256,
      receiptArtifact: {
        uri: chronoReceiptIdentityUri(record.receipt.receipt_sha256),
        fingerprint: receiptFingerprint,
      },
    },
    projection: { status: "available", record },
  };
  session.basis.sessionFingerprint = await chronoRecordedSessionFingerprint(
    session,
  );
  return session;
}

Deno.test("parser accepts run, run_get recorded and receipt_get closed records", () => {
  assertEquals(parseChronoRunView(runResult), {
    kind: "recorded",
    replayed: false,
    record: recorded,
  });
  assertEquals(parseChronoRunView(runGetRecorded), {
    kind: "recorded",
    record: recorded,
  });
  assertEquals(parseChronoRunView(receiptGet), {
    kind: "recorded",
    record: recorded,
  });
});

Deno.test("parser preserves literal uncertain and absent states", () => {
  assertEquals(parseChronoRunView(uncertain), {
    kind: "uncertain",
    intent: uncertain.intent,
  });
  assertEquals(parseChronoRunView(absent), { kind: "absent" });
});

Deno.test("recorded viewer session joins anchor, receipt and exact outcome", async () => {
  const session = await viewerSessionFixture();
  const parsed = await parseChronoViewerSession(session);
  assertEquals(parsed.projection.status, "available");
  if (parsed.projection.status !== "available") {
    throw new Error("expected available recorded session");
  }
  const view = chronoRunViewFromDurableRecord(parsed.projection.record);
  assertEquals(view.kind, "recorded");
  if (view.kind === "recorded") {
    assertEquals(view.record.request.request_id, "wire-paged");
    assertEquals(view.record.observation.sample_count, 2);
    assertEquals(
      view.record.observation.sample_time_range_s.last,
      0.9999999999999999,
    );
  }
});

Deno.test("re-signed session substitutions cannot replace recorded bytes", async () => {
  const originalOutcome = await viewerSessionFixture();
  const changedOutcome = {
    ...originalOutcome,
    basis: { ...originalOutcome.basis },
    projection: {
      ...originalOutcome.projection,
      record: {
        ...originalOutcome.projection.record,
        output: {
          ...originalOutcome.projection.record.output,
          samples: [
            originalOutcome.projection.record.output.samples[0],
            {
              ...originalOutcome.projection.record.output.samples[1],
              time_s: 0.75,
            },
          ],
        },
      },
    },
  };
  changedOutcome.basis.sessionFingerprint = await chronoRecordedSessionFingerprint(
    changedOutcome,
  );
  await assertRejects(
    () => parseChronoViewerSession(changedOutcome),
    TypeError,
    "outcome SHA-256",
  );

  const changedAnchor = await viewerSessionFixture();
  const substituted = "e".repeat(64);
  changedAnchor.anchor.uri = chronoReceiptIdentityUri(substituted);
  changedAnchor.anchor.fingerprint = "sha256:" + substituted;
  changedAnchor.provenance.receiptArtifact = {
    uri: changedAnchor.anchor.uri,
    fingerprint: changedAnchor.anchor.fingerprint,
  };
  changedAnchor.basis.sessionFingerprint = await chronoRecordedSessionFingerprint(
    changedAnchor,
  );
  await assertRejects(
    () => parseChronoViewerSession(changedAnchor),
    TypeError,
    "recorded receipt",
  );
});

Deno.test("viewer session receiver preserves pre-connect FIFO delivery", async () => {
  let listener:
    | ((payload: { readonly data: unknown }) => void)
    | undefined;
  const receiver = createBufferedSessionReceiver<string>({
    events: {
      on(action, next) {
        assertEquals(action, VIEWER_SESSION_APPLY_ACTION);
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
    action: VIEWER_SESSION_APPLY_ACTION,
    map: (value) => String(value),
    onError: (error) => {
      throw error;
    },
  });
  listener?.({ data: "first" });
  listener?.({ data: "second" });
  const observed: string[] = [];
  await receiver.activate((value) => {
    observed.push(value);
  });
  listener?.({ data: "third" });
  await receiver.drain();
  assertEquals(observed, ["first", "second", "third"]);
  receiver.dispose();
  assertEquals(listener, undefined);
});

Deno.test("parser keeps the exact terminal sample time and does not relabel it", () => {
  const parsed = parseChronoRunView(runResult);
  if (parsed.kind !== "recorded") throw new Error("expected recorded");
  assertEquals(
    parsed.record.sample_page.samples.at(-1)?.time_s,
    0.9999999999999999,
  );
  assertEquals(
    parsed.record.observation.sample_time_range_s.last,
    0.9999999999999999,
  );
  assertEquals(formatExactNumber(0.9999999999999999), "0.9999999999999999");
  assertEquals(formatExactNumber(1), "1");
});

Deno.test("parser rejects extra fields, invented states and unbounded pages", () => {
  assertThrows(
    () => parseChronoRunView({ ...runResult, extra: true }),
    TypeError,
    "unsupported fields",
  );
  assertThrows(
    () => parseChronoRunView({ ok: true, state: "completed" }),
    TypeError,
    "recorded, uncertain or absent",
  );
  assertThrows(
    () =>
      parseChronoRunView({
        ...receiptGet,
        record: {
          ...recorded,
          observation: { ...recorded.observation, execution_state: "success" },
        },
      }),
    TypeError,
    "completed or not_converged",
  );
  const unbounded = JSON.parse(JSON.stringify(runResult));
  unbounded.record.sample_page.samples.push(
    unbounded.record.sample_page.samples[0],
  );
  assertThrows(
    () => parseChronoRunView(unbounded),
    TypeError,
    "returned differs",
  );
  assertThrows(
    () =>
      parseChronoRunView({
        ...receiptGet,
        record: {
          ...recorded,
          case_uri: `chrono-case:sha256:${"e".repeat(64)}`,
        },
      }),
    TypeError,
    "differs from the recorded request identity",
  );
  assertThrows(
    () =>
      parseChronoRunView({
        ...receiptGet,
        record: {
          ...recorded,
          sample_page: { ...recorded.sample_page, limit: 1 },
        },
      }),
    TypeError,
    "returned exceeds sample_page.limit",
  );
});

Deno.test({
  name: "lifecycle states render the shared busy and error component",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("linkedom");
    const dom = documentModule.parseHTML("<html><body></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: dom.document,
    });
    try {
      const loading = renderDisplayState({ kind: "loading" });
      assertEquals(
        loading.querySelector(".mcp-view-state")?.getAttribute("aria-busy"),
        "true",
      );
      assertEquals(loading.querySelectorAll(".mcp-view-state-busy").length, 1);
      const error = renderDisplayState({
        kind: "error",
        message: "<script>not markup</script>",
      });
      assertEquals(
        error.querySelector(".mcp-view-state")?.getAttribute("role"),
        "alert",
      );
      assertStringIncludes(error.textContent ?? "", "<script>not markup</script>");
      assertEquals(error.querySelector("script"), null);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test("parser rejects kinematics_exit pairs that are not native facts", () => {
  assertThrows(
    () =>
      parseChronoRunView({
        ...receiptGet,
        record: {
          ...recorded,
          observation: {
            ...recorded.observation,
            kinematics_exit: { raw_code: 1, raw_name: "PASS" },
          },
          receipt: {
            ...recorded.receipt,
            kinematics_exit: { raw_code: 1, raw_name: "PASS" },
          },
        },
      }),
    TypeError,
    "native kinematics exit",
  );
});

Deno.test("tool results map errors, json-text fallback and empty content", () => {
  assertEquals(
    displayStateFromToolResult({
      isError: true,
      content: [{ type: "text", text: "runner_timeout: timed out" }],
    }),
    { kind: "error", message: "runner_timeout: timed out" },
  );
  assertEquals(
    displayStateFromToolResult({
      content: [
        {
          type: "text",
          text: "Recorded run result replayed exactly as a bounded result page.",
        },
        { type: "text", text: JSON.stringify(runResult) },
      ],
    }),
    { kind: "recorded", replayed: false, record: recorded },
  );
  assertEquals(
    displayStateFromToolResult({
      content: [{ type: "text", text: "Human-readable summary" }],
    }),
    { kind: "empty" },
  );
  assertEquals(
    toolErrorMessage({
      content: [{ type: "text", text: "store_corrupt: unsupported" }],
    }),
    "store_corrupt: unsupported",
  );
});

Deno.test("default surface is exactly one recorded-run business component", () => {
  const catalog = advertisedComponentCatalog(CHRONO_COMPONENT_REGISTRY);
  assertEquals(Object.keys(catalog.components), [
    CHRONO_COMPONENT_KEYS.recordedRun,
  ]);
  assertEquals(catalog.defaultSurface, CHRONO_RUN_RECORD_SURFACE);
  assertEquals(CHRONO_RUN_RECORD_SURFACE.layout, { type: "stack", gap: "sm" });
  assertEquals(CHRONO_RUN_RECORD_SURFACE.components, [{
    id: "recorded-run",
    component: CHRONO_COMPONENT_KEYS.recordedRun,
  }]);
  assertEquals(CHRONO_APP_INFO, {
    name: "io.casys.mcp-chrono.run-record",
    version: PROVIDER_VERSION,
  });
  assertEquals(CHRONO_VIEW_APP_MANIFEST.app, {
    id: "io.casys.mcp-chrono.run-record",
    title: "Chrono Recorded Run",
    version: PROVIDER_VERSION,
  });
  assertEquals(
    CHRONO_VIEW_APP_MANIFEST.resources[0].acceptedActions,
    [VIEWER_SESSION_APPLY_ACTION],
  );
  assertEquals(
    CHRONO_VIEW_APP_MANIFEST.resources[0].sessionSchemas,
    [CHRONO_VIEWER_SESSION_SCHEMA],
  );
  assertEquals(
    CHRONO_VIEW_APP_MANIFEST_JSON,
    JSON.stringify(CHRONO_VIEW_APP_MANIFEST) + "\n",
  );
});

Deno.test("a malformed host surface is recoverable by a later valid context", () => {
  const malformed = resolveChronoSurface({
    [CASYS_SURFACE_CONTEXT_KEY]: {
      instanceId: "whiteboard",
      status: "ready",
      source: "requested",
      surface: {
        layout: { type: "grid", columns: 0 },
        components: [{
          id: "recorded-run",
          component: CHRONO_COMPONENT_KEYS.recordedRun,
        }],
      },
    },
  });
  assertEquals(malformed.ok, false);
  if (!malformed.ok) {
    assertStringIncludes(
      malformed.message,
      "host-selected component surface is invalid",
    );
  }
  assertEquals(resolveChronoSurface({}), {
    ok: true,
    surface: CHRONO_RUN_RECORD_SURFACE,
  });
});

Deno.test("compact default source does not import invented verdict or bound widgets", async () => {
  const source = await Deno.readTextFile(
    new URL("./components.tsx", import.meta.url),
  );
  assertEquals(source.includes("LimitGauge"), false);
  assertEquals(source.includes("ElementVerdict"), false);
  assertEquals(source.includes('tone: "'), false);
  assertEquals(source.includes("pass/fail"), false);
});

Deno.test({
  name: "default surface renders one factual run-record card",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withMountedSurface(
      { kind: "recorded", replayed: false, record: recorded },
      {},
      async (root, mounted) => {
        assertEquals(root.querySelectorAll("[data-component]").length, 1);
        assertEquals(
          root.querySelector("[data-component]")?.getAttribute(
            "data-component",
          ),
          CHRONO_COMPONENT_KEYS.recordedRun,
        );
        const card = root.querySelector(".mcp-view-semantic-element");
        assertEquals(card?.getAttribute("data-density"), "card");
        assertEquals(card?.getAttribute("data-semantic-domain"), "chrono");
        assertEquals(card?.getAttribute("data-semantic-kind"), "recorded-run");
        assertEquals(card?.hasAttribute("data-tone"), false);
        assertEquals(root.querySelector("[data-element-slot=verdict]"), null);
        assertEquals(root.querySelector(".mcp-view-limit-gauge"), null);
        assertStringIncludes(root.textContent ?? "", "wire-paged");
        assertStringIncludes(root.textContent ?? "", "completed");
        assertStringIncludes(root.textContent ?? "", "0.9999999999999999");
        assertStringIncludes(root.textContent ?? "", RECEIPT_SHA);
        assertEquals(root.textContent?.includes("Bounded sample page"), false);
        assertEquals(root.textContent?.includes("Receipt provenance"), false);
        assertEquals((root.textContent ?? "").includes("pass"), false);
        assertEquals((root.textContent ?? "").includes("proof"), false);
        await mounted.dispose();
        assertEquals(root.textContent, "");
      },
    );
  },
});

Deno.test({
  name: "uncertain and absent states stay literal on the compact surface",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withMountedSurface(
      {
        kind: "uncertain",
        intent: uncertain.intent,
      },
      {},
      (root) => {
        assertStringIncludes(root.textContent ?? "", "uncertain");
        assertStringIncludes(root.textContent ?? "", "open-intent");
        assertEquals(root.querySelector(".mcp-view-semantic-element"), null);
      },
    );
    await withMountedSurface({ kind: "absent" }, {}, (root) => {
      assertStringIncludes(root.textContent ?? "", "absent");
      assertEquals(root.querySelector(".mcp-view-table"), null);
    });
  },
});

async function withMountedSurface(
  data: ChronoRunView,
  hostContext: Record<string, unknown>,
  run: (
    root: HTMLElement,
    mounted: Awaited<ReturnType<typeof mountComponentSurface>>,
  ) => void | Promise<void>,
): Promise<void> {
  const documentModule = await import("linkedom");
  const dom = documentModule.parseHTML(
    "<html><body><div id=root></div></body></html>",
  );
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.document,
  });
  try {
    const root = dom.document.getElementById("root") as unknown as HTMLElement;
    const mounted = await mountComponentSurface({
      root,
      registry: CHRONO_COMPONENT_REGISTRY,
      data,
      appContext: componentContext,
      hostContext: hostContext as PreactSurfaceContext<
        ChronoRunView
      >["hostContext"],
    });
    try {
      await run(root, mounted);
    } finally {
      await mounted.dispose();
    }
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
}
