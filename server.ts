import { createStaticTokenAuthProvider } from "@casys/mcp-server";
import { createDefaultApp } from "./src/client.ts";
import { parseCliTransport } from "./src/cli.ts";
import { PROVIDER_VERSION } from "./src/domain/types.ts";

if (parseCliTransport(Deno.args) === "stdio") {
  await createDefaultApp().start();
} else {
  const portText = Deno.env.get("PORT") ?? "3025";
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }
  const host = Deno.env.get("HOST") ?? "127.0.0.1";
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  const auth = loopback ? undefined : (() => {
    const tokens = (Deno.env.get("MCP_AUTH_TOKENS") ?? "").split(",").map((token) =>
      token.trim()
    ).filter(Boolean);
    const resource = Deno.env.get("MCP_AUTH_RESOURCE");
    if (tokens.length === 0 || !resource) {
      throw new Error(
        "Non-loopback HTTP requires MCP_AUTH_TOKENS and MCP_AUTH_RESOURCE.",
      );
    }
    return { provider: createStaticTokenAuthProvider(tokens, { resource }) };
  })();
  const app = createDefaultApp(undefined, auth ? { auth } : {});
  await app.startHttp({
    port,
    hostname: host,
    cors: false,
    maxBodyBytes: 600_000,
    requireAuth: !loopback,
    customRoutes: [{
      method: "get",
      path: "/healthz",
      handler: () =>
        Response.json({
          status: "ok",
          service: "mcp-chrono",
          version: PROVIDER_VERSION,
        }),
    }],
    onListen: ({ hostname, port }) =>
      console.error(`[mcp-chrono] listening on http://${hostname}:${port}`),
  });
}
