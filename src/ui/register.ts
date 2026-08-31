import type { McpApp } from "@casys/mcp-server";

export const CHRONO_RUN_RECORD_VIEWER = "run-record-viewer";
export const CHRONO_RUN_RECORD_VIEWER_URI =
  `ui://mcp-chrono/${CHRONO_RUN_RECORD_VIEWER}` as const;

/**
 * Register the exact built run-record HTML resource. Missing dist is skipped
 * so text-only clients can still start; hosts that support MCP Apps read the
 * committed single-file document.
 */
export function registerChronoRunRecordViewer(app: McpApp): void {
  app.registerViewers({
    prefix: "mcp-chrono",
    viewers: [CHRONO_RUN_RECORD_VIEWER],
    moduleUrl: new URL("../../server.ts", import.meta.url).href,
    exists: viewerExists,
    readFile: readViewer,
    humanName: () => "Chrono run record",
  });
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
