import { PROVIDER_VERSION } from "../domain/types.ts";
import serializedViewAppManifest from "./app-manifest.json" with {
  type: "json",
};

export const CHRONO_RUN_RECORD_VIEWER = "run-record-viewer" as const;
export const CHRONO_RUN_RECORD_VIEWER_URI =
  "ui://mcp-chrono/run-record-viewer" as const;
export const CHRONO_VIEW_APP_MANIFEST_URI = "ui://mcp-chrono/app-manifest" as const;
export const CHRONO_VIEWER_SESSION_SCHEMA =
  "io.casys.mcp-chrono.recorded-run-session/1.0" as const;
export const CHRONO_VIEWER_SESSION_KIND = "chrono.recorded-run" as const;
export const VIEWER_SESSION_APPLY_ACTION = "viewer.session.apply" as const;
export const VIEW_APP_MANIFEST_SCHEMA = "io.casys.mcp.view-app-manifest/1.0" as const;

export const CHRONO_RESULT_SCHEMA_IDS = {
  prescribedRun: "io.casys.mcp-chrono.prescribed-kinematics-run-result/1.0",
  recordedLookup: "io.casys.mcp-chrono.recorded-run-lookup/1.0",
  receiptLookup: "io.casys.mcp-chrono.recorded-receipt-lookup/1.0",
} as const;

export interface ChronoViewAppManifest {
  readonly schemaVersion: typeof VIEW_APP_MANIFEST_SCHEMA;
  readonly app: {
    readonly id: "io.casys.mcp-chrono.run-record";
    readonly title: "Chrono Recorded Run";
    readonly version: typeof PROVIDER_VERSION;
  };
  readonly resources: readonly [{
    readonly uri: typeof CHRONO_RUN_RECORD_VIEWER_URI;
    readonly ownership: "whole-view";
    readonly resultSchemas: readonly string[];
    readonly acceptedActions: readonly [typeof VIEWER_SESSION_APPLY_ACTION];
    readonly sessionSchemas: readonly [typeof CHRONO_VIEWER_SESSION_SCHEMA];
  }];
}

/** Exact package artifact served by the provider for host-side App discovery. */
export const CHRONO_VIEW_APP_MANIFEST = parseChronoViewAppManifest(
  serializedViewAppManifest,
);

/** Canonical bytes exposed by the manifest MCP resource. */
export const CHRONO_VIEW_APP_MANIFEST_JSON = JSON.stringify(CHRONO_VIEW_APP_MANIFEST) +
  "\n";

function parseChronoViewAppManifest(value: unknown): ChronoViewAppManifest {
  const root = exactRecord(
    value,
    ["schemaVersion", "app", "resources"],
    "Chrono View App manifest",
  );
  literal(
    root.schemaVersion,
    VIEW_APP_MANIFEST_SCHEMA,
    "Chrono View App manifest.schemaVersion",
  );
  const app = exactRecord(
    root.app,
    ["id", "title", "version"],
    "Chrono View App manifest.app",
  );
  literal(
    app.id,
    "io.casys.mcp-chrono.run-record",
    "Chrono View App manifest.app.id",
  );
  literal(
    app.title,
    "Chrono Recorded Run",
    "Chrono View App manifest.app.title",
  );
  literal(
    app.version,
    PROVIDER_VERSION,
    "Chrono View App manifest.app.version",
  );
  const resources = denseArray(
    root.resources,
    "Chrono View App manifest.resources",
  );
  if (resources.length !== 1) {
    throw new TypeError(
      "Chrono View App manifest.resources must contain exactly one whole view.",
    );
  }
  const resource = exactRecord(
    resources[0],
    [
      "uri",
      "ownership",
      "resultSchemas",
      "acceptedActions",
      "sessionSchemas",
    ],
    "Chrono View App manifest.resources[0]",
  );
  literal(
    resource.uri,
    CHRONO_RUN_RECORD_VIEWER_URI,
    "Chrono View App manifest.resources[0].uri",
  );
  literal(
    resource.ownership,
    "whole-view",
    "Chrono View App manifest.resources[0].ownership",
  );
  const expectedResultSchemas = Object.values(CHRONO_RESULT_SCHEMA_IDS);
  const resultSchemas = denseArray(
    resource.resultSchemas,
    "Chrono View App manifest.resources[0].resultSchemas",
  );
  if (
    resultSchemas.length !== expectedResultSchemas.length ||
    resultSchemas.some((schema, index) => schema !== expectedResultSchemas[index])
  ) {
    throw new TypeError(
      "Chrono View App manifest result schemas do not match the provider contracts.",
    );
  }
  const acceptedActions = denseArray(
    resource.acceptedActions,
    "Chrono View App manifest.resources[0].acceptedActions",
  );
  if (
    acceptedActions.length !== 1 ||
    acceptedActions[0] !== VIEWER_SESSION_APPLY_ACTION
  ) {
    throw new TypeError(
      "Chrono View App manifest must accept viewer.session.apply exactly.",
    );
  }
  const sessionSchemas = denseArray(
    resource.sessionSchemas,
    "Chrono View App manifest.resources[0].sessionSchemas",
  );
  if (
    sessionSchemas.length !== 1 ||
    sessionSchemas[0] !== CHRONO_VIEWER_SESSION_SCHEMA
  ) {
    throw new TypeError(
      "Chrono View App manifest must bind the recorded-run session schema exactly.",
    );
  }
  return {
    schemaVersion: VIEW_APP_MANIFEST_SCHEMA,
    app: {
      id: "io.casys.mcp-chrono.run-record",
      title: "Chrono Recorded Run",
      version: PROVIDER_VERSION,
    },
    resources: [{
      uri: CHRONO_RUN_RECORD_VIEWER_URI,
      ownership: "whole-view",
      resultSchemas: expectedResultSchemas,
      acceptedActions: [VIEWER_SESSION_APPLY_ACTION],
      sessionSchemas: [CHRONO_VIEWER_SESSION_SCHEMA],
    }],
  };
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

function denseArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(name + " must be an array.");
  }
  if (Object.keys(value).length !== value.length) {
    throw new TypeError(name + " must be a dense unadorned array.");
  }
  return value;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(name + " must be an object.");
  }
  const root = value as Record<string, unknown>;
  const actual = Object.keys(root).toSorted();
  const expected = [...keys].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(name + " contains missing or unsupported fields.");
  }
  return root;
}
