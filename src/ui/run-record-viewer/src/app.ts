import { createMcpApp, defineView } from "@casys/mcp-view";
import {
  activeComponentSurface,
  applySurfaceContext,
  componentCatalogCapabilities,
  type ComponentSurface,
  installMcpViewTheme,
  type McpViewHostContext,
  mountComponentSurface,
  type MountedComponentSurface,
} from "@casys/mcp-view-components";
import {
  type PresentationTone,
  StateMessage,
} from "@casys/mcp-view-components/preact/components";
import { createElement, render } from "preact";
import { PROVIDER_VERSION } from "../../../domain/types.ts";
import { CHRONO_COMPONENT_REGISTRY } from "./components.tsx";
import {
  type ChronoRunView,
  type DisplayState,
  displayStateFromToolResult,
} from "./model.ts";

type RunRecordViewerState = Record<string, never>;

export const CHRONO_APP_INFO = {
  name: "casys-chrono-run-record",
  version: PROVIDER_VERSION,
} as const;

/** Start the MCP-owned Chrono run-record projection. */
export async function startChronoRunRecordApp(
  root: HTMLElement,
): Promise<void> {
  installMcpViewTheme();
  const state: RunRecordViewerState = {};
  let mounted: MountedComponentSurface | undefined;
  let pendingMount: Promise<void> | undefined;
  let mountGeneration = 0;
  let currentResult: ChronoRunView | undefined;
  let removeHostContextListener: (() => void) | undefined;

  const reportError = (error: unknown): void => {
    console.error("[mcp-chrono] Run-record projection failed", error);
  };

  const disposeSurface = async (): Promise<void> => {
    mountGeneration += 1;
    await pendingMount;
    pendingMount = undefined;
    const active = mounted;
    mounted = undefined;
    await active?.dispose();
  };

  const status = defineView<RunRecordViewerState, DisplayState, DisplayState>({
    onEnter: (_context, next) => {
      currentResult = undefined;
      return next;
    },
    render(_context, next) {
      return renderDisplayState(next);
    },
    onLeave: disposeSurface,
  });

  const surface = defineView<
    RunRecordViewerState,
    ChronoRunView,
    ChronoRunView
  >({
    onEnter: (_context, data) => {
      currentResult = data;
      return data;
    },
    render(context, data) {
      const shell = document.createElement("div");
      shell.className = "chrono-component-surface";
      const resolution = resolveChronoSurface(context.hostContext);
      if (!resolution.ok) {
        shell.replaceChildren(message(resolution.message, "danger", "error"));
        return shell;
      }
      const selected = resolution.surface;
      const generation = ++mountGeneration;
      pendingMount = mountComponentSurface({
        root: shell,
        registry: CHRONO_COMPONENT_REGISTRY,
        data,
        appContext: context,
        hostContext: context.hostContext,
        surface: selected,
      }).then(async (next) => {
        if (generation !== mountGeneration) {
          await next.dispose();
          return;
        }
        mounted = next;
      }).catch((error) => {
        shell.replaceChildren(message(
          `The Chrono component surface failed: ${errorMessage(error)}`,
          "danger",
          "error",
        ));
        reportError(error);
      });
      return shell;
    },
    onLeave: disposeSurface,
  });

  const handle = await createMcpApp<RunRecordViewerState>({
    info: CHRONO_APP_INFO,
    root,
    strict: true,
    views: { status, surface },
    initialView: "status",
    initialArgs: { kind: "loading" } satisfies DisplayState,
    initialState: state,
    capabilities: {
      experimental: componentCatalogCapabilities(CHRONO_COMPONENT_REGISTRY),
    },
    onToolInputPartial: async (_params, app) => {
      await app.navigate("status", { kind: "loading" } satisfies DisplayState);
    },
    onToolResult: async (result, app) => {
      try {
        await showDisplayState(app.navigate, displayStateFromToolResult(result));
      } catch (error) {
        await app.navigate(
          "status",
          {
            kind: "error",
            message: errorMessage(error),
          } satisfies DisplayState,
        );
      }
    },
    onTeardown: async () => {
      removeHostContextListener?.();
      removeHostContextListener = undefined;
      currentResult = undefined;
      await disposeSurface();
    },
  });

  const onHostContextChanged = (): void => {
    applySurfaceContext(handle.ctx.hostContext, document.documentElement);
    if (!currentResult || handle.currentView !== "surface") return;
    void handle.navigate("surface", currentResult).catch(reportError);
  };
  handle.ctx.app.addEventListener("hostcontextchanged", onHostContextChanged);
  applySurfaceContext(handle.ctx.hostContext, document.documentElement);
  removeHostContextListener = () => {
    handle.ctx.app.removeEventListener(
      "hostcontextchanged",
      onHostContextChanged,
    );
  };
}

export type ChronoSurfaceResolution =
  | { readonly ok: true; readonly surface: ComponentSurface }
  | { readonly ok: false; readonly message: string };

/** Keep the active route mounted when a host sends a malformed surface. */
export function resolveChronoSurface(
  hostContext: McpViewHostContext,
): ChronoSurfaceResolution {
  try {
    const surface = activeComponentSurface(
      CHRONO_COMPONENT_REGISTRY,
      hostContext,
    );
    return surface ? { ok: true, surface } : {
      ok: false,
      message: "This App exposes components and requires a host-selected surface.",
    };
  } catch (error) {
    return {
      ok: false,
      message: `The host-selected component surface is invalid: ${errorMessage(error)}`,
    };
  }
}

async function showDisplayState(
  navigate: (name: string, args?: unknown) => Promise<void>,
  state: DisplayState,
): Promise<void> {
  if (
    state.kind === "recorded" || state.kind === "uncertain" ||
    state.kind === "absent"
  ) {
    await navigate("surface", state);
    return;
  }
  await navigate("status", state);
}

export function renderDisplayState(state: DisplayState): HTMLElement {
  switch (state.kind) {
    case "loading":
      return message(
        "Receiving a Chrono run record or readback…",
        "info",
        "Loading",
        true,
      );
    case "empty":
      return message(
        "Chrono returned no supported run-record projection.",
        "neutral",
        "Empty",
      );
    case "error":
      return message(state.message, "danger", "error");
    case "recorded":
    case "uncertain":
    case "absent":
      throw new TypeError(
        "Run-record data must render through the component surface.",
      );
  }
}

function message(
  detail: string,
  tone: PresentationTone,
  title?: string,
  busy = false,
): HTMLElement {
  const node = document.createElement("div");
  node.className = "chrono-viewer-state";
  render(
    createElement(StateMessage, { busy, title, tone }, detail),
    node,
  );
  return node;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
