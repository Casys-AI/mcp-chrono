import { assertEquals, assertThrows } from "@std/assert";
import { parseCliTransport } from "../src/cli.ts";

Deno.test("CLI transport parser accepts only the documented transport forms", () => {
  assertEquals(parseCliTransport([]), "http");
  assertEquals(parseCliTransport(["--stdio"]), "stdio");
});

Deno.test("CLI transport parser rejects mixed and unknown arguments", () => {
  for (
    const args of [
      ["--stdio", "--port", "3025"],
      ["--stdio", "--unknown"],
      ["--port", "3025"],
      ["--unknown"],
    ]
  ) {
    assertThrows(
      () => parseCliTransport(args),
      Error,
      "Invalid CLI arguments: expected no arguments for HTTP or exactly --stdio for stdio",
    );
  }
});
