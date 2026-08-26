import { ChronoWorkerRunner } from "./adapters/chrono/runner.ts";
import { ChronoService } from "./application/service.ts";
import { FileChronoStore } from "./application/store.ts";
import { type ChronoAppOptions, createChronoApp } from "./server.ts";

export function createDefaultApp(
  storeRoot = Deno.env.get("CHRONO_STORE_DIR") ?? "./data",
  options: ChronoAppOptions = {},
): ReturnType<typeof createChronoApp> {
  return createChronoApp(
    new ChronoService(new FileChronoStore(storeRoot), new ChronoWorkerRunner()),
    options,
  );
}
