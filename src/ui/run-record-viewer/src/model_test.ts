import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  advertisedComponentCatalog,
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
import {
  CHRONO_APP_INFO,
  CHRONO_STATUS_CLASS,
  chronoSurfaceAppOptions,
  displayStateFromViewerSession,
  renderStartupFailure,
  SESSION_REJECTED_CODE,
  toSurfaceState,
} from "./app.ts";
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
  // The kit frames the surface and separates stacked components with hairlines.
  assertEquals(CHRONO_RUN_RECORD_SURFACE.layout, { type: "stack", gap: "none" });
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

Deno.test("the App projects tool results and recorded sessions through the model", async () => {
  const options = chronoSurfaceAppOptions({} as HTMLElement);
  assertEquals(options.info, CHRONO_APP_INFO);
  assertEquals(options.strict, true);
  assertEquals(options.surfaceClassName, "chrono-component-surface");
  assertEquals(options.statusClassName, CHRONO_STATUS_CLASS);
  const host = {
    readServerResource: () => Promise.reject(new Error("must not read")),
  };

  assertEquals(
    await options.fromToolResult?.({
      content: [],
      structuredContent: runGetRecorded,
    }, host),
    { kind: "result", result: { kind: "recorded", record: recorded } },
  );
  assertEquals(
    await options.fromToolResult?.({
      content: [{ type: "text", text: "Worker unavailable" }],
      isError: true,
    }, host),
    { kind: "error", message: "Worker unavailable" },
  );

  const session = options.viewerSession;
  if (!session) throw new Error("the App must subscribe to viewer sessions");
  // Every payload of the whole-view action reaches the strict parser; no
  // `onInvalid` exists because nothing is ever dropped before it.
  assertEquals(session.validate({ schema: "nope" }), true);
  assertEquals(session.onInvalid, undefined);
  const rejected = await session.toState({ schema: "nope" }, host);
  assertEquals(rejected.kind, "error");
  if (rejected.kind === "error") {
    assertEquals(rejected.title, "Session rejected");
    assertEquals(rejected.code, SESSION_REJECTED_CODE);
    assertStringIncludes(
      rejected.message,
      `Rejected ${CHRONO_VIEWER_SESSION_SCHEMA} session:`,
    );
  }
  const available = await session.toState(await viewerSessionFixture(), host);
  assertEquals(available.kind, "result");
  if (available.kind === "result") assertEquals(available.result.kind, "recorded");

  const base = await viewerSessionFixture();
  const unresolvedSession = {
    ...base,
    basis: { ...base.basis },
    projection: { status: "unresolved", reason: "TRACE GAP" } as const,
  };
  unresolvedSession.basis.sessionFingerprint = await chronoRecordedSessionFingerprint(
    unresolvedSession,
  );
  assertEquals(await displayStateFromViewerSession(unresolvedSession), {
    kind: "unresolved",
    reason: "TRACE GAP",
  });
  assertEquals(await session.toState(unresolvedSession, host), {
    kind: "notice",
    tone: "warning",
    title: "Recorded Chrono run unresolved",
    message: "TRACE GAP",
    code: "unresolved",
  });
});

Deno.test("ledger states are warning notices carrying the status; every run state is a result", () => {
  assertEquals(toSurfaceState({ kind: "loading" }), { kind: "loading" });
  assertEquals(
    toSurfaceState({ kind: "error", message: "boom" }),
    { kind: "error", message: "boom" },
  );
  assertEquals(
    toSurfaceState({ kind: "unavailable", reason: "receipt quarantined" }),
    {
      kind: "notice",
      tone: "warning",
      title: "Recorded Chrono run unavailable",
      message: "receipt quarantined",
      code: "unavailable",
    },
  );
  assertEquals(
    toSurfaceState({ kind: "absent" }),
    { kind: "result", result: { kind: "absent" } },
  );
  const uncertainView = parseChronoRunView(uncertain);
  assertEquals(
    toSurfaceState(uncertainView),
    { kind: "result", result: uncertainView },
  );
});

Deno.test("a viewer that cannot start renders the shared danger state", async () => {
  const documentModule = await import("linkedom");
  const dom = documentModule.parseHTML("<html><body></body></html>");
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.document,
  });
  try {
    const failure = renderStartupFailure(new Error("transport refused"));
    assertEquals(failure.classList.contains("mcp-view-state"), true);
    assertEquals(failure.classList.contains(CHRONO_STATUS_CLASS), true);
    assertEquals(failure.getAttribute("data-tone"), "danger");
    assertStringIncludes(failure.textContent ?? "", "Chrono viewer unavailable");
    assertStringIncludes(failure.textContent ?? "", "transport refused");
    assertStringIncludes(
      renderStartupFailure("not an error").textContent ?? "",
      "The viewer could not start.",
    );
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
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
        // The reference contract wants the bare receipt digest as the basis.
        assertEquals(card?.getAttribute("data-basis-fingerprint"), RECEIPT_SHA);
        assertEquals(card?.hasAttribute("data-tone"), false);
        assertEquals(root.querySelector("[data-element-slot=verdict]"), null);
        assertEquals(root.querySelector(".mcp-view-limit-gauge"), null);
        const text = root.textContent ?? "";
        assertStringIncludes(text, "wire-paged");
        assertStringIncludes(text, "Prescribed kinematics run");
        // The engine's literal facts headline the sheet, spelled exactly.
        assertEquals(
          Array.from(
            root.querySelectorAll(".mcp-view-element-reading-value"),
            (value) => value.textContent,
          ),
          ["completed", "2", "0 → 0.9999999999999999", "SUCCESS"],
        );
        assertStringIncludes(text, "raw code 1");
        assertEquals(
          Array.from(
            root.querySelectorAll(".mcp-view-element-section-title"),
            (title) => title.textContent,
          ),
          ["Engine", "Provenance", "Digests"],
        );
        assertStringIncludes(text, "Project Chrono 10.0.0");
        assertStringIncludes(text, "pychrono · Python 3.12.0");
        assertStringIncludes(text, "Not evaluated");
        assertStringIncludes(text, "collision, clearance, contact");
        assertStringIncludes(text, "2026-08-28T00:00:00.000Z");
        // The case row spells its digest as uri and as fingerprint; every other digest once.
        assertEquals(text.split(CASE_SHA).length - 1, 2);
        assertEquals(text.split(OUTCOME_SHA).length - 1, 1);
        assertEquals(text.split(WORKER_SHA).length - 1, 1);
        assertEquals(
          root.querySelector(".mcp-view-element-provenance code")?.textContent,
          RECEIPT_SHA,
        );
        assertEquals(text.includes("Bounded sample page"), false);
        assertEquals(text.includes("Receipt provenance"), false);
        assertEquals(text.includes("pass"), false);
        assertEquals(text.includes("proof"), false);
        assertEquals(text.includes("_"), false, "no raw field names on the sheet");
        await mounted.dispose();
        assertEquals(root.textContent, "");
      },
    );
  },
});

Deno.test({
  name:
    "a run that did not converge keeps its literal state and turns the sheet to warning",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const notConverged: ChronoRunRecordView = {
      ...recorded,
      observation: {
        ...recorded.observation,
        execution_state: "not_converged",
        kinematics_exit: { raw_code: 0, raw_name: "NOT_CONVERGED" },
      },
    };
    await withMountedSurface(
      { kind: "recorded", replayed: true, record: notConverged },
      {},
      (root) => {
        const card = root.querySelector(".mcp-view-semantic-element");
        assertEquals(card?.getAttribute("data-tone"), "warning");
        assertStringIncludes(root.textContent ?? "", "not_converged");
        assertStringIncludes(root.textContent ?? "", "NOT_CONVERGED");
        assertStringIncludes(
          root.textContent ?? "",
          "replayed from the existing record",
        );
        assertEquals(root.querySelector("[data-element-slot=verdict]"), null);
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
