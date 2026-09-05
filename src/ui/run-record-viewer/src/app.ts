import {
  type PreactSurfaceAppOptions,
  renderStatusMessage,
  startPreactSurfaceApp,
  type SurfaceAppHandle,
  type SurfaceDisplayState,
} from "@casys/mcp-view-components/preact";
import { installMcpViewFonts } from "@casys/mcp-view-components/fonts";
import {
  CHRONO_VIEW_APP_MANIFEST,
  CHRONO_VIEWER_SESSION_SCHEMA,
} from "../../app-contract.ts";
import { parseChronoViewerSession } from "../../../viewer-session.ts";
import { CHRONO_COMPONENT_REGISTRY } from "./components.tsx";
import { chronoMessages } from "./messages.ts";
import {
  type ChronoRunView,
  chronoRunViewFromDurableRecord,
  type DisplayState,
  displayStateFromToolResult,
} from "./model.ts";

export const CHRONO_APP_INFO = {
  name: CHRONO_VIEW_APP_MANIFEST.app.id,
  version: CHRONO_VIEW_APP_MANIFEST.app.version,
} as const;

/** Class of every status the viewer renders, for its own styling hooks. */
export const CHRONO_STATUS_CLASS = "chrono-viewer-state";

export type ChronoSurfaceState = SurfaceDisplayState<ChronoRunView>;
export type ChronoSurfaceAppOptions = PreactSurfaceAppOptions<
  ChronoRunView,
  unknown
>;

/** Start the MCP-owned Chrono run-record projection. */
export function startChronoRunRecordApp(
  root: HTMLElement,
): Promise<SurfaceAppHandle<ChronoRunView>> {
  // Hosts sandbox the App without web fonts; the kit embeds its three faces.
  installMcpViewFonts(root.ownerDocument);
  return startPreactSurfaceApp(chronoSurfaceAppOptions(root));
}

/** The App configuration, exposed so its projections are testable without a host. */
export function chronoSurfaceAppOptions(
  root: HTMLElement,
): ChronoSurfaceAppOptions {
  return {
    root,
    info: CHRONO_APP_INFO,
    registry: CHRONO_COMPONENT_REGISTRY,
    strict: true,
    surfaceClassName: "chrono-component-surface",
    statusClassName: CHRONO_STATUS_CLASS,
    documentLanguage: chronoMessages.locale,
    // Token-following primitives; in-place keeps the native disclosure open state.
    themeUpdates: "in-place",
    loadingLabel: (locale) => chronoMessages(locale)("loadingMessage"),
    emptyLabel: (locale) => chronoMessages(locale)("emptyMessage"),
    fromToolResult: (result) => toSurfaceState(displayStateFromToolResult(result)),
    viewerSession: {
      // Every `viewer.session.apply` payload addresses this whole-view App;
      // the strict parser decides. Rejections keep their literal code and
      // diagnostic, while the title follows the host locale.
      validate: (_value: unknown): _value is unknown => true,
      toState: async (value) => {
        try {
          return toSurfaceState(await displayStateFromViewerSession(value));
        } catch (error) {
          return {
            kind: "error",
            title: (locale) => chronoMessages(locale)("sessionRejectedTitle"),
            code: "session-rejected",
            message: `Rejected ${CHRONO_VIEWER_SESSION_SCHEMA} session: ${
              errorMessage(error)
            }`,
          };
        }
      },
    },
    onError: (error) => {
      console.error("[mcp-chrono] Run-record projection failed", error);
    },
  };
}

/** Preserve literal unresolved and unavailable states; map only available records. */
export async function displayStateFromViewerSession(
  value: unknown,
): Promise<DisplayState> {
  const session = await parseChronoViewerSession(value);
  if (session.projection.status === "available") {
    return chronoRunViewFromDurableRecord(session.projection.record);
  }
  return { kind: session.projection.status, reason: session.projection.reason };
}

/**
 * Map a Chrono display state onto the shared surface states. Unresolved and
 * unavailable recorded runs are notices, not errors: nothing failed, the
 * ledger simply holds no record to show. `code` carries the ledger status.
 */
export function toSurfaceState(
  state: DisplayState,
): ChronoSurfaceState {
  switch (state.kind) {
    case "loading":
    case "empty":
    case "error":
      return state;
    case "unresolved":
      return {
        kind: "notice",
        tone: "warning",
        title: (locale) => chronoMessages(locale)("unresolvedTitle"),
        message: state.reason,
        code: state.kind,
      };
    case "unavailable":
      return {
        kind: "notice",
        tone: "warning",
        title: (locale) => chronoMessages(locale)("unavailableTitle"),
        message: state.reason,
        code: state.kind,
      };
    case "recorded":
    case "uncertain":
    case "absent":
      return { kind: "result", result: state };
  }
}

/** The danger state shown when the App itself cannot start. */
export function renderStartupFailure(
  error: unknown,
  locale?: string,
): HTMLElement {
  const t = chronoMessages(locale);
  return renderStatusMessage(
    error instanceof Error ? error.message : t("startupFallback"),
    {
      className: CHRONO_STATUS_CLASS,
      title: t("startupTitle"),
      tone: "danger",
    },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
