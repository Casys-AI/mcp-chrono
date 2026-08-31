/**
 * Provider-owned, read-only contract for reopening one exact recorded Chrono run.
 *
 * The host transports this envelope unchanged through viewer.session.apply.
 * No Digital Thread project shape or operation identity is presumed here.
 */

import { PROVIDER_VERSION } from "./domain/types.ts";
import {
  CHRONO_VIEWER_SESSION_KIND,
  CHRONO_VIEWER_SESSION_SCHEMA,
} from "./ui/app-contract.ts";
import {
  type ChronoDurableRunRecord,
  type ChronoRunReceipt,
  parseChronoDurableRunRecord,
} from "./ui/run-record-viewer/src/model.ts";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const CASE_URI = /^chrono-case:sha256:([a-f0-9]{64})$/;
const RECEIPT_URI = /^chrono-receipt:sha256:([a-f0-9]{64})$/;

export interface ChronoViewerSessionBasis {
  readonly sessionFingerprint: string;
}

export interface ChronoViewerSessionAnchor {
  readonly kind: "chrono-recorded-run";
  readonly id: string;
  readonly uri: string;
  readonly fingerprint: string;
}

export interface ChronoViewerSessionProvenance {
  readonly kind: "mcp-chrono-recorded-run";
  readonly server: {
    readonly package: "@casys/mcp-chrono";
    readonly version: typeof PROVIDER_VERSION;
  };
  readonly requestId: string;
  readonly caseArtifact: {
    readonly uri: string;
    readonly fingerprint: string;
  };
  readonly outcomeFingerprint: string;
  readonly receiptArtifact: {
    readonly uri: string;
    readonly fingerprint: string;
  };
}

export type ChronoViewerSessionProjection =
  | {
    readonly status: "available";
    readonly record: ChronoDurableRunRecord;
  }
  | { readonly status: "unresolved"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

export interface ChronoViewerSession {
  readonly schemaVersion: typeof CHRONO_VIEWER_SESSION_SCHEMA;
  readonly kind: typeof CHRONO_VIEWER_SESSION_KIND;
  readonly basis: ChronoViewerSessionBasis;
  readonly anchor: ChronoViewerSessionAnchor;
  readonly provenance: ChronoViewerSessionProvenance;
  readonly projection: ChronoViewerSessionProjection;
}

/** Canonical provider identity URI; it is not advertised as an MCP resource. */
export function chronoReceiptIdentityUri(receiptSha256: string): string {
  const digest = fingerprintDigest(
    "sha256:" + receiptSha256,
    "receipt SHA-256",
  );
  return "chrono-receipt:sha256:" + digest;
}

/**
 * Strictly validate one recorded-run session, including all receipt, outcome,
 * anchor, and session-fingerprint joins.
 */
export async function parseChronoViewerSession(
  value: unknown,
): Promise<ChronoViewerSession> {
  const session = parseChronoViewerSessionStructure(value);
  const actualFingerprint = await chronoRecordedSessionFingerprint(value);
  if (session.basis.sessionFingerprint !== actualFingerprint) {
    throw new TypeError(
      "viewer session.basis.sessionFingerprint does not match the recorded session.",
    );
  }
  await assertChronoViewerSessionJoins(session);
  return session;
}

function parseChronoViewerSessionStructure(value: unknown): ChronoViewerSession {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "basis",
    "anchor",
    "provenance",
    "projection",
  ], "viewer session");
  literal(
    root.schemaVersion,
    CHRONO_VIEWER_SESSION_SCHEMA,
    "viewer session.schemaVersion",
  );
  literal(root.kind, CHRONO_VIEWER_SESSION_KIND, "viewer session.kind");
  const basisValue = exactRecord(
    root.basis,
    ["sessionFingerprint"],
    "viewer session.basis",
  );
  const basis = {
    sessionFingerprint: fingerprint(
      basisValue.sessionFingerprint,
      "viewer session.basis.sessionFingerprint",
    ),
  };
  const anchorValue = exactRecord(
    root.anchor,
    ["kind", "id", "uri", "fingerprint"],
    "viewer session.anchor",
  );
  const anchor = {
    kind: literal(
      anchorValue.kind,
      "chrono-recorded-run",
      "viewer session.anchor.kind",
    ),
    id: requestId(anchorValue.id, "viewer session.anchor.id"),
    uri: receiptUri(anchorValue.uri, "viewer session.anchor.uri"),
    fingerprint: fingerprint(
      anchorValue.fingerprint,
      "viewer session.anchor.fingerprint",
    ),
  };
  const provenance = parseProvenance(root.provenance);
  const projectionValue = record(
    root.projection,
    "viewer session.projection",
  );
  let projection: ChronoViewerSessionProjection;
  if (projectionValue.status === "available") {
    exactKeys(
      projectionValue,
      ["status", "record"],
      "viewer session.projection",
    );
    projection = {
      status: "available",
      record: parseChronoDurableRunRecord(projectionValue.record),
    };
  } else if (
    projectionValue.status === "unresolved" ||
    projectionValue.status === "unavailable"
  ) {
    exactKeys(
      projectionValue,
      ["status", "reason"],
      "viewer session.projection",
    );
    projection = {
      status: projectionValue.status,
      reason: nonEmpty(
        projectionValue.reason,
        "viewer session.projection.reason",
      ),
    };
  } else {
    throw new TypeError(
      "viewer session.projection.status must be available, unresolved, or unavailable.",
    );
  }
  return {
    schemaVersion: CHRONO_VIEWER_SESSION_SCHEMA,
    kind: CHRONO_VIEWER_SESSION_KIND,
    basis,
    anchor,
    provenance,
    projection,
  };
}

function parseProvenance(value: unknown): ChronoViewerSessionProvenance {
  const root = exactRecord(value, [
    "kind",
    "server",
    "requestId",
    "caseArtifact",
    "outcomeFingerprint",
    "receiptArtifact",
  ], "viewer session.provenance");
  literal(
    root.kind,
    "mcp-chrono-recorded-run",
    "viewer session.provenance.kind",
  );
  const server = exactRecord(
    root.server,
    ["package", "version"],
    "viewer session.provenance.server",
  );
  literal(
    server.package,
    "@casys/mcp-chrono",
    "viewer session.provenance.server.package",
  );
  literal(
    server.version,
    PROVIDER_VERSION,
    "viewer session.provenance.server.version",
  );
  const caseArtifact = exactRecord(
    root.caseArtifact,
    ["uri", "fingerprint"],
    "viewer session.provenance.caseArtifact",
  );
  const receiptArtifact = exactRecord(
    root.receiptArtifact,
    ["uri", "fingerprint"],
    "viewer session.provenance.receiptArtifact",
  );
  return {
    kind: "mcp-chrono-recorded-run",
    server: {
      package: "@casys/mcp-chrono",
      version: PROVIDER_VERSION,
    },
    requestId: requestId(
      root.requestId,
      "viewer session.provenance.requestId",
    ),
    caseArtifact: {
      uri: caseUri(
        caseArtifact.uri,
        "viewer session.provenance.caseArtifact.uri",
      ),
      fingerprint: fingerprint(
        caseArtifact.fingerprint,
        "viewer session.provenance.caseArtifact.fingerprint",
      ),
    },
    outcomeFingerprint: fingerprint(
      root.outcomeFingerprint,
      "viewer session.provenance.outcomeFingerprint",
    ),
    receiptArtifact: {
      uri: receiptUri(
        receiptArtifact.uri,
        "viewer session.provenance.receiptArtifact.uri",
      ),
      fingerprint: fingerprint(
        receiptArtifact.fingerprint,
        "viewer session.provenance.receiptArtifact.fingerprint",
      ),
    },
  };
}

/**
 * SHA-256 of the complete session, excluding only the self-referential
 * basis.sessionFingerprint field.
 */
export async function chronoRecordedSessionFingerprint(
  value: unknown,
): Promise<string> {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "basis",
    "anchor",
    "provenance",
    "projection",
  ], "viewer session fingerprint input");
  exactRecord(
    root.basis,
    ["sessionFingerprint"],
    "viewer session fingerprint input.basis",
  );
  return await canonicalFingerprint({
    schemaVersion: root.schemaVersion,
    kind: root.kind,
    basis: {},
    anchor: root.anchor,
    provenance: root.provenance,
    projection: root.projection,
  });
}

/** SHA-256 of the canonical complete durable Chrono outcome. */
export async function chronoOutcomeFingerprint(value: unknown): Promise<string> {
  return await canonicalFingerprint(value);
}

/** SHA-256 of the canonical receipt preimage, excluding receipt_sha256. */
export async function chronoReceiptFingerprint(
  receipt: ChronoRunReceipt,
): Promise<string> {
  const {
    receipt_sha256: _receiptSha256,
    ...preimage
  } = receipt;
  return await canonicalFingerprint(preimage);
}

async function assertChronoViewerSessionJoins(
  session: ChronoViewerSession,
): Promise<void> {
  const provenance = session.provenance;
  const receiptArtifact = provenance.receiptArtifact;
  assertAddressJoin(
    provenance.caseArtifact.uri,
    provenance.caseArtifact.fingerprint,
    CASE_URI,
    "viewer session.provenance.caseArtifact",
  );
  assertAddressJoin(
    receiptArtifact.uri,
    receiptArtifact.fingerprint,
    RECEIPT_URI,
    "viewer session.provenance.receiptArtifact",
  );
  if (
    session.anchor.id !== provenance.requestId ||
    session.anchor.uri !== receiptArtifact.uri ||
    session.anchor.fingerprint !== receiptArtifact.fingerprint
  ) {
    throw new TypeError(
      "viewer session.anchor must identify the exact recorded Chrono receipt.",
    );
  }
  if (session.projection.status !== "available") return;
  const recordValue = session.projection.record;
  const receipt = recordValue.receipt;
  if (
    recordValue.request.request_id !== provenance.requestId ||
    receipt.request_id !== provenance.requestId
  ) {
    throw new TypeError(
      "viewer session request identity differs from its recorded run.",
    );
  }
  if (
    recordValue.case_uri !== provenance.caseArtifact.uri ||
    "sha256:" + recordValue.request.case_sha256 !==
      provenance.caseArtifact.fingerprint ||
    receipt.case_sha256 !== recordValue.request.case_sha256
  ) {
    throw new TypeError(
      "viewer session case artifact differs from its recorded run.",
    );
  }
  if (
    "sha256:" + receipt.receipt_sha256 !== receiptArtifact.fingerprint ||
    chronoReceiptIdentityUri(receipt.receipt_sha256) !== receiptArtifact.uri
  ) {
    throw new TypeError(
      "viewer session receipt artifact differs from its recorded receipt.",
    );
  }
  const receiptFingerprint = await chronoReceiptFingerprint(receipt);
  if (receiptFingerprint !== receiptArtifact.fingerprint) {
    throw new TypeError(
      "viewer session receipt preimage does not match its receipt SHA-256.",
    );
  }
  if (
    provenance.outcomeFingerprint !== "sha256:" + receipt.outcome_sha256
  ) {
    throw new TypeError(
      "viewer session outcome identity differs from its recorded receipt.",
    );
  }
  const outcomeFingerprint = await chronoOutcomeFingerprint(recordValue.output);
  if (outcomeFingerprint !== provenance.outcomeFingerprint) {
    throw new TypeError(
      "viewer session durable outcome does not match its outcome SHA-256.",
    );
  }
}

function assertAddressJoin(
  uri: string,
  artifactFingerprint: string,
  pattern: RegExp,
  name: string,
): void {
  const match = pattern.exec(uri);
  if (!match || artifactFingerprint !== "sha256:" + match[1]) {
    throw new TypeError(name + " URI and fingerprint must identify the same bytes.");
  }
}

async function canonicalFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value, "canonical data"));
  const digestBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes),
  );
  return "sha256:" + Array.from(
    digestBytes,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function canonicalJson(value: unknown, name: string): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(name + " must contain only finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) {
      throw new TypeError(name + " arrays must be dense and unadorned.");
    }
    return "[" + value.map((item) => canonicalJson(item, name)).join(",") + "]";
  }
  if (typeof value === "object" && value !== null) {
    const objectValue = value as Record<string, unknown>;
    return "{" + Object.keys(objectValue).sort().map((key) =>
      JSON.stringify(key) + ":" + canonicalJson(objectValue[key], name)
    ).join(",") + "}";
  }
  throw new TypeError(name + " must contain only JSON values.");
}

function literal<T extends string>(
  value: unknown,
  expected: T,
  name: string,
): T {
  if (value !== expected) {
    throw new TypeError(name + " must be " + expected + ".");
  }
  return expected;
}

function requestId(value: unknown, name: string): string {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw new TypeError(name + " must be a bounded request identity.");
  }
  return value;
}

function fingerprint(value: unknown, name: string): string {
  if (typeof value !== "string" || !FINGERPRINT.test(value)) {
    throw new TypeError(name + " must be a lowercase SHA-256 fingerprint.");
  }
  return value;
}

function fingerprintDigest(value: unknown, name: string): string {
  return fingerprint(value, name).slice("sha256:".length);
}

function caseUri(value: unknown, name: string): string {
  if (typeof value !== "string" || !CASE_URI.test(value)) {
    throw new TypeError(name + " must be a Chrono case content URI.");
  }
  return value;
}

function receiptUri(value: unknown, name: string): string {
  if (typeof value !== "string" || !RECEIPT_URI.test(value)) {
    throw new TypeError(name + " must be a Chrono receipt identity URI.");
  }
  return value;
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(name + " must be a non-empty string.");
  }
  return value;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  const root = record(value, name);
  exactKeys(root, keys, name);
  return root;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(name + " contains missing or unsupported fields.");
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(name + " must be an object.");
  }
  return value as Record<string, unknown>;
}
