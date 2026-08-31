import { PROVIDER_VERSION } from "../src/domain/types.ts";
import { CHRONO_VIEWER_SESSION_SCHEMA } from "../src/ui/app-contract.ts";
import type { ChronoDurableRunRecord } from "../src/ui/run-record-viewer/src/model.ts";
import {
  chronoOutcomeFingerprint,
  chronoReceiptFingerprint,
  chronoReceiptIdentityUri,
  chronoRecordedSessionFingerprint,
  parseChronoViewerSession,
} from "../src/viewer-session.ts";

const caseSha = "a".repeat(64);
const recordedAt = "2026-08-31T00:00:00.000Z";
const requestId = "documentation-fixture-not-evidence";

const output: ChronoDurableRunRecord["output"] = {
  engine: { name: "Project Chrono", version: "10.0.0" },
  runtime: { binding: "pychrono", python_version: "3.12.0" },
  samples: [
    {
      time_s: 0,
      bodies: [{
        id: "fixture-root",
        position_m: [0, 0, 0] as const,
        rotation_wxyz: [1, 0, 0, 0] as const,
      }],
      motors: [],
    },
    {
      time_s: 1,
      bodies: [{
        id: "fixture-root",
        position_m: [0, 0, 0] as const,
        rotation_wxyz: [1, 0, 0, 0] as const,
      }],
      motors: [],
    },
  ],
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
  ] as const,
  execution_state: "completed" as const,
  kinematics_exit: { raw_code: 1, raw_name: "SUCCESS" },
};

const outcomeFingerprint = await chronoOutcomeFingerprint(output);
const receiptSeed = {
  schema_id: "chrono-prescribed-kinematics-receipt/1.0" as const,
  receipt_sha256: "0".repeat(64),
  case_sha256: caseSha,
  outcome_sha256: outcomeFingerprint.slice("sha256:".length),
  request_id: requestId,
  recorded_at: recordedAt,
  package: { name: "@casys/mcp-chrono" as const, version: PROVIDER_VERSION },
  provider: { name: "casys-chrono" as const, version: PROVIDER_VERSION },
  worker: { source_sha256: "b".repeat(64) },
  runtime: output.runtime,
  server_runtime: { deno_version: "2.9.6" },
  execution_state: output.execution_state,
  kinematics_exit: output.kinematics_exit,
};
const receiptFingerprint = await chronoReceiptFingerprint(receiptSeed);
const record: ChronoDurableRunRecord = {
  request: { request_id: requestId, case_sha256: caseSha },
  case_uri: `chrono-case:sha256:${caseSha}`,
  recorded_at: recordedAt,
  output,
  receipt: {
    ...receiptSeed,
    receipt_sha256: receiptFingerprint.slice("sha256:".length),
  },
};
const receiptUri = chronoReceiptIdentityUri(record.receipt.receipt_sha256);
const session = {
  schemaVersion: CHRONO_VIEWER_SESSION_SCHEMA,
  kind: "chrono.recorded-run" as const,
  basis: { sessionFingerprint: "sha256:" + "0".repeat(64) },
  anchor: {
    kind: "chrono-recorded-run" as const,
    id: requestId,
    uri: receiptUri,
    fingerprint: receiptFingerprint,
  },
  provenance: {
    kind: "mcp-chrono-recorded-run" as const,
    server: { package: "@casys/mcp-chrono" as const, version: PROVIDER_VERSION },
    requestId,
    caseArtifact: {
      uri: record.case_uri,
      fingerprint: `sha256:${caseSha}`,
    },
    outcomeFingerprint,
    receiptArtifact: { uri: receiptUri, fingerprint: receiptFingerprint },
  },
  projection: { status: "available" as const, record },
};
session.basis.sessionFingerprint = await chronoRecordedSessionFingerprint(session);
await parseChronoViewerSession(session);

const target = new URL(
  "../docs/fixtures/recorded-run-session.demo.json",
  import.meta.url,
);
await Deno.mkdir(new URL("../docs/fixtures/", import.meta.url), {
  recursive: true,
});
await Deno.writeTextFile(target, JSON.stringify(session, null, 2) + "\n");
console.log(`wrote ${target.pathname}`);
