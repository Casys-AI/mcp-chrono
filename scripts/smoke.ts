import { createChronoApp } from "../src/server.ts";
import { ChronoService } from "../src/application/service.ts";
import { FileChronoStore } from "../src/application/store.ts";
import { FakeRunner, observation } from "../tests/test-helpers.ts";

const fake = new FakeRunner();
const app = createChronoApp(
  new ChronoService(new FileChronoStore(await Deno.makeTempDir()), fake),
);
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const http = await app.startHttp({
  port,
  hostname: "127.0.0.1",
  cors: false,
  onListen: () => {},
});
try {
  const health = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  if (!health.ok) throw new Error(`MCP smoke failed: ${health.status}`);
  console.log(JSON.stringify(observation().engine));
} finally {
  await http.shutdown();
}
