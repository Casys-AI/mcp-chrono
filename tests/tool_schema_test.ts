import { assert, assertEquals } from "@std/assert";
import {
  failureSchema,
  manifestOutputSchema,
  runGetOutputSchema,
  runOutputSchema,
  templateOutputSchema,
} from "../src/tools/schemas.ts";

function assertObjectSchemasClosed(value: unknown, path = "schema"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertObjectSchemasClosed(entry, `${path}[${index}]`)
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  const schema = value as Record<string, unknown>;
  if (schema.type === "object") {
    assertEquals(
      schema.additionalProperties,
      false,
      `${path} must reject undeclared properties`,
    );
  }
  for (const [key, child] of Object.entries(schema)) {
    // A const is an exact value, not a subschema requiring object-shape keywords.
    if (key !== "const") assertObjectSchemasClosed(child, `${path}.${key}`);
  }
}

Deno.test("important MCP output schemas close every declared object recursively", () => {
  for (
    const [name, schema] of Object.entries({
      manifestOutputSchema,
      templateOutputSchema,
      failureSchema,
      runOutputSchema,
      runGetOutputSchema,
    })
  ) {
    assertObjectSchemasClosed(schema, name);
  }
});

Deno.test("run lookup output is a discriminated recorded uncertain absent union", () => {
  const states = runGetOutputSchema.oneOf
    .map((branch) => {
      const properties = (branch as {
        properties?: Record<string, { const?: unknown }>;
      }).properties;
      return properties?.state?.const;
    })
    .filter((state): state is string => typeof state === "string");
  assertEquals(states, ["recorded", "uncertain", "absent"]);
  assert(runGetOutputSchema.oneOf.includes(failureSchema));
});
