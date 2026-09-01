import serializedViewAppManifest from "./app-manifest.json" with {
  type: "json",
};
import {
  defineViewAppManifest,
  VIEW_APP_MANIFEST_SCHEMA,
  VIEWER_SESSION_APPLY_ACTION,
} from "@casys/mcp-view-contracts";

export { VIEW_APP_MANIFEST_SCHEMA, VIEWER_SESSION_APPLY_ACTION };

export const CHRONO_RUN_RECORD_VIEWER = "run-record-viewer" as const;
export const CHRONO_RUN_RECORD_VIEWER_URI =
  "ui://mcp-chrono/run-record-viewer" as const;
export const CHRONO_VIEW_APP_MANIFEST_URI = "ui://mcp-chrono/app-manifest" as const;
export const CHRONO_VIEWER_SESSION_SCHEMA =
  "io.casys.mcp-chrono.recorded-run-session/1.0" as const;
export const CHRONO_VIEWER_SESSION_KIND = "chrono.recorded-run" as const;

export const CHRONO_RESULT_SCHEMA_IDS = {
  prescribedRun: "io.casys.mcp-chrono.prescribed-kinematics-run-result/1.0",
  recordedLookup: "io.casys.mcp-chrono.recorded-run-lookup/1.0",
  receiptLookup: "io.casys.mcp-chrono.recorded-receipt-lookup/1.0",
} as const;

/** Exact package artifact served by the provider for host-side App discovery. */
export const CHRONO_VIEW_APP_MANIFEST = defineViewAppManifest(
  serializedViewAppManifest,
);

/** Canonical bytes exposed by the manifest MCP resource. */
export const CHRONO_VIEW_APP_MANIFEST_JSON = JSON.stringify(CHRONO_VIEW_APP_MANIFEST) +
  "\n";
