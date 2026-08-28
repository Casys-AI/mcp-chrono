import { assert, assertEquals } from "@std/assert";
import {
  caseGetOutputSchema,
  failureSchema,
  manifestOutputSchema,
  receiptGetOutputSchema,
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
      caseGetOutputSchema,
      runOutputSchema,
      runGetOutputSchema,
      receiptGetOutputSchema,
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

Deno.test("kinematics exit schema declares only native code and name pairs", () => {
  const success = runOutputSchema.oneOf[0] as unknown as {
    properties: {
      record: {
        oneOf: Array<{
          properties: {
            observation: {
              properties: { kinematics_exit: object };
            };
          };
        }>;
      };
    };
  };
  const schema = success.properties.record.oneOf[0].properties.observation.properties
    .kinematics_exit as {
      properties: { raw_code: unknown; raw_name: unknown };
      oneOf: Array<{
        properties: {
          raw_code: { const: number };
          raw_name: { const: string };
        };
      }>;
    };
  // `additionalProperties: false` applies only to sibling `properties` in
  // JSON Schema, so keep the two names declared at the closed object level.
  assertEquals(Object.keys(schema.properties).sort(), ["raw_code", "raw_name"]);
  assertEquals(
    schema.oneOf.map((pair) => [
      pair.properties.raw_code.const,
      pair.properties.raw_name.const,
    ]),
    [
      [0, "NOT_CONVERGED"],
      [1, "SUCCESS"],
      [2, "ABSTOL_RESIDUAL"],
      [3, "RELTOL_UPDATE"],
      [4, "ABSTOL_UPDATE"],
    ],
  );
});
