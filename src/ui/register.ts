import type { McpApp } from "@casys/mcp-server";
import {
  CHRONO_RUN_RECORD_VIEWER,
  CHRONO_VIEW_APP_MANIFEST,
  CHRONO_VIEW_APP_MANIFEST_JSON,
  CHRONO_VIEW_APP_MANIFEST_URI,
} from "./app-contract.ts";

export {
  CHRONO_RUN_RECORD_VIEWER,
  CHRONO_RUN_RECORD_VIEWER_URI,
} from "./app-contract.ts";

/**
 * Register the exact built run-record HTML resource. Missing dist is skipped
 * so text-only clients can still start; hosts that support MCP Apps read the
 * committed single-file document.
 */
export function registerChronoRunRecordViewer(app: McpApp): void {
  const summary = app.registerViewers({
    prefix: "mcp-chrono",
    viewers: [CHRONO_RUN_RECORD_VIEWER],
    moduleUrl: new URL("../../server.ts", import.meta.url).href,
    exists: viewerExists,
    readFile: readViewer,
    humanName: () => "Chrono run record",
  });
  if (summary.registered.includes(CHRONO_RUN_RECORD_VIEWER)) {
    registerChronoViewAppManifest(app);
  }
}

/** Publish the exact serialized App contract next to its HTML resource. */
export function registerChronoViewAppManifest(app: McpApp): void {
  const bytes = new TextEncoder().encode(CHRONO_VIEW_APP_MANIFEST_JSON);
  app.registerResource(
    {
      uri: CHRONO_VIEW_APP_MANIFEST_URI,
      name: "Chrono View App manifest",
      description:
        `Exact ${CHRONO_VIEW_APP_MANIFEST.app.id}@${CHRONO_VIEW_APP_MANIFEST.app.version} ` +
        "whole-view and recorded-session contract.",
      mimeType: "application/json",
      size: bytes.byteLength,
    },
    (requested) => {
      if (requested.toString() !== CHRONO_VIEW_APP_MANIFEST_URI) {
        throw new Error(
          "Requested URI does not match the Chrono App manifest.",
        );
      }
      return {
        uri: CHRONO_VIEW_APP_MANIFEST_URI,
        mimeType: "application/json",
        text: CHRONO_VIEW_APP_MANIFEST_JSON,
      };
    },
  );
}

function viewerExists(path: string): boolean {
  if (isRemoteViewerUrl(path)) return true;
  try {
    return Deno.statSync(path).isFile;
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.PermissionDenied ||
      (error instanceof Error && error.name === "NotCapable")
    ) {
      return false;
    }
    throw error;
  }
}

async function readViewer(path: string): Promise<string> {
  if (!isRemoteViewerUrl(path)) return await Deno.readTextFile(path);
  let response: Response;
  try {
    response = await fetch(path);
  } catch (error) {
    throw new Error(
      `Unable to fetch Chrono run-record viewer from ${path}.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Unable to fetch Chrono run-record viewer from ${path}: HTTP ${response.status} ${response.statusText}.`,
    );
  }
  return await response.text();
}

function isRemoteViewerUrl(path: string): boolean {
  return path.startsWith("https://") || path.startsWith("http://");
}
