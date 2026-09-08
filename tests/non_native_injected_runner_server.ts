import { ChronoService } from "../src/application/service.ts";
import { FileChronoStore } from "../src/application/store.ts";
import type { RunObservation } from "../src/domain/types.ts";
import { createChronoApp } from "../src/server.ts";
import { FakeRunner } from "./test-helpers.ts";

/**
 * Non-native stdio helper: injects a caller-supplied worker observation.
 * This is not a Project Chrono execution path.
 */
if (import.meta.main) {
  const encoded = Deno.env.get("CHRONO_INJECTED_OBSERVATION");
  if (!encoded) {
    throw new Error(
      "CHRONO_INJECTED_OBSERVATION is required for this non-native test server.",
    );
  }
  const observation = JSON.parse(encoded) as RunObservation;
  const storeRoot = Deno.env.get("CHRONO_STORE_DIR");
  if (!storeRoot) {
    throw new Error("CHRONO_STORE_DIR is required for this non-native test server.");
  }
  await createChronoApp(
    new ChronoService(new FileChronoStore(storeRoot), new FakeRunner(observation)),
  ).start();
}
