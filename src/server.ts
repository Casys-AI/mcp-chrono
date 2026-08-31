import { type AuthOptions, McpApp } from "@casys/mcp-server";
import { ChronoService } from "./application/service.ts";
import { PROVIDER_VERSION } from "./domain/types.ts";
import { registerChronoTools } from "./tools/register.ts";
import { registerChronoRunRecordViewer } from "./ui/register.ts";

export interface ChronoAppOptions {
  auth?: AuthOptions;
}

export function createChronoApp(
  service: ChronoService,
  options: ChronoAppOptions = {},
): McpApp {
  const app = new McpApp({
    name: "casys-chrono",
    version: PROVIDER_VERSION,
    transport: "stateless",
    maxConcurrent: 1,
    backpressureStrategy: "queue",
    validateSchema: true,
    ...(options.auth ? { auth: options.auth } : {}),
    toolErrorMapper: (error) => {
      const mapped = error instanceof Error && "code" in error
        ? error as { code: unknown; message: string }
        : undefined;
      return mapped && typeof mapped.code === "string"
        ? `${mapped.code}: ${mapped.message}`
        : "internal_error: An internal provider error occurred.";
    },
    instructions:
      "Explicit Project Chrono 10.0.0 prescribed rigid-body kinematics only. This provider reports factual observations and never decides product fitness.",
    logger: (message) => console.error(`[mcp-chrono] ${message}`),
  });
  registerChronoTools(app, service);
  registerChronoRunRecordViewer(app);
  return app;
}
