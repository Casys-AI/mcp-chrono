import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const PINNED_MCP_SERVER_COMMIT = "8fad891839203122efbe2438ba81a6e7d08c9202";

Deno.test("viewer build fails closed without every audited split root", async () => {
  const repository = fromFileUrl(new URL("../", import.meta.url));
  const result = await new Deno.Command(Deno.execPath(), {
    cwd: repository,
    args: [
      "run",
      "--config",
      "deno.json",
      "-A",
      "src/ui/run-record-viewer/build.ts",
    ],
    env: {
      MCP_VIEW_LOCAL_ROOT: "",
      MCP_VIEW_CONTRACTS_LOCAL_ROOT: "",
      MCP_VIEW_COMPONENTS_LOCAL_ROOT: "",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.success, false);
  const error = new TextDecoder().decode(result.stderr);
  assertStringIncludes(error, "Missing MCP_VIEW_LOCAL_ROOT");
  assertStringIncludes(error, "no published compatibility fallback");
});

Deno.test("viewer sources have no monolithic 0.7 compatibility route", async () => {
  const retiredSpecifier = ["@casys/mcp-view", "0.7"].join("@");
  const files = [
    "../deno.json",
    "../src/ui/run-record-viewer/build.ts",
    "../src/ui/run-record-viewer/deno.json",
    "../src/ui/run-record-viewer/local-modules.ts",
  ];
  for (const relative of files) {
    const contents = await Deno.readTextFile(new URL(relative, import.meta.url));
    assertEquals(
      contents.includes(retiredSpecifier),
      false,
      `${relative} must not retain the retired compatibility package`,
    );
  }
  const rootConfig = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { tasks?: Record<string, string> };
  assertStringIncludes(rootConfig.tasks?.["release:check"] ?? "", "check:ui:bundle");
  assertStringIncludes(rootConfig.tasks?.["build:ui"] ?? "", "--frozen");
});

Deno.test("CI pins the exact mcp-server checkout for viewer rebuilds", async () => {
  for (
    const relative of [
      "../.github/workflows/ci.yml",
      "../.github/workflows/release.yml",
    ]
  ) {
    const workflow = await Deno.readTextFile(new URL(relative, import.meta.url));
    assertStringIncludes(workflow, "repository: Casys-AI/mcp-server");
    assertStringIncludes(workflow, `ref: ${PINNED_MCP_SERVER_COMMIT}`);
    assertStringIncludes(workflow, "MCP_VIEW_LOCAL_ROOT");
    assertStringIncludes(workflow, "MCP_VIEW_CONTRACTS_LOCAL_ROOT");
    assertStringIncludes(workflow, "MCP_VIEW_COMPONENTS_LOCAL_ROOT");
    assertStringIncludes(workflow, "deno task check:ui:bundle");
  }
});

Deno.test("Chrono run-record viewer is one syntactically valid inline module", async () => {
  const viewer = new URL(
    "../src/ui/dist/run-record-viewer/index.html",
    import.meta.url,
  );
  const html = await Deno.readTextFile(viewer);
  assertEquals(
    (html.match(/<!doctype html>/gi) ?? []).length,
    1,
    "the built viewer must contain exactly one HTML document",
  );
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assertEquals(scripts.length, 1, "the viewer must contain one inline module");
  const source = scripts[0][1];
  assert(source.trim().length > 0, "the inline module must not be empty");
  assertEquals(source.includes("BUNDLE_PLACEHOLDER"), false);
  assertEquals(source.includes("<!doctype html>"), false);
  new Function(source);
});

Deno.test("built Chrono viewer contains its App-owned whole view", async () => {
  const html = await Deno.readTextFile(
    new URL("../src/ui/dist/run-record-viewer/index.html", import.meta.url),
  );
  assert(html.includes("io.casys.mcp.surface/v1"));
  assert(html.includes("io.casys.mcp.view-components/v1"));
  assert(html.includes("chrono.recorded-run"));
  assertEquals(html.includes("chrono.run-summary"), false);
  assertEquals(html.includes("chrono.sample-page"), false);
  assertEquals(html.includes("chrono.execution-facts"), false);
  assertEquals(html.includes("chrono.receipt-provenance"), false);
  assert(html.includes("mcp-view-semantic-element"));
  assert(html.includes("io.casys.mcp-chrono.run-record"));
  assert(html.includes("viewer.session.apply"));
  assert(html.includes("io.casys.mcp-chrono.recorded-run-session/1.0"));
  assert(html.includes("mcp-view-inline-code"));
  assert(html.includes("mcp-view-state-busy"));
  assert(html.includes("color-scheme: light dark"));
  assert(html.includes(':root[data-theme="dark"]'));
  assertEquals(html.includes("LimitGauge"), false);
  assertEquals(html.includes("ElementVerdict"), false);
  assertEquals(html.includes("MCP RESULT"), false);
  assertEquals(html.includes('class="masthead"'), false);
});
