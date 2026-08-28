/**
 * Select the one transport the native entry point may start.
 *
 * HTTP configuration is intentionally environment-only. Accepting a loose
 * argument set here would let a typo or a mixed invocation silently select a
 * different transport than the caller intended.
 */
export function parseCliTransport(args: readonly string[]): "http" | "stdio" {
  if (args.length === 0) return "http";
  if (args.length === 1 && args[0] === "--stdio") return "stdio";

  throw new Error(
    "Invalid CLI arguments: expected no arguments for HTTP or exactly --stdio for stdio; " +
      `received ${JSON.stringify(args)}.`,
  );
}
