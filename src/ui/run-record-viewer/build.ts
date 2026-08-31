import { dirname, fromFileUrl, join } from "@std/path";
import { withAuditedViewerDenoConfig } from "./local-modules.ts";

const here = dirname(fromFileUrl(import.meta.url));
export const VERSIONED_RUN_RECORD_VIEWER = join(
  here,
  "..",
  "dist",
  "run-record-viewer",
  "index.html",
);

export async function buildRunRecordViewer(
  output = VERSIONED_RUN_RECORD_VIEWER,
): Promise<void> {
  await withAuditedViewerDenoConfig(async (configPath) => {
    const temporaryDirectory = await Deno.makeTempDir({
      prefix: "mcp-chrono-run-record-viewer-",
    });
    const bundlePath = join(temporaryDirectory, "run-record-viewer.js");
    try {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "bundle",
          "--config",
          configPath,
          `--lock=${join(here, "deno.lock")}`,
          "--frozen",
          "--check",
          "--platform=browser",
          "--minify",
          join(here, "src", "main.ts"),
          "--output",
          bundlePath,
        ],
        stdout: "piped",
        stderr: "piped",
      });
      const result = await command.output();
      if (!result.success) {
        throw new Error(new TextDecoder().decode(result.stderr));
      }
      const template = await Deno.readTextFile(join(here, "index.html"));
      const css = await Deno.readTextFile(join(here, "src", "styles.css"));
      const js = await Deno.readTextFile(bundlePath);
      const html = template
        .replace("/* STYLES_PLACEHOLDER */", () => css)
        .replace("/* BUNDLE_PLACEHOLDER */", () => js)
        .replaceAll(/[ \t]+(?=\r?\n)/g, "");
      await Deno.mkdir(dirname(output), { recursive: true });
      await Deno.writeTextFile(output, html);
    } finally {
      await Deno.remove(temporaryDirectory, { recursive: true });
    }
  });
  console.log("[run-record-viewer] wrote " + output);
}

if (import.meta.main) {
  await buildRunRecordViewer();
}
