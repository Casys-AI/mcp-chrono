import { type McpApp, type StructuredToolResult } from "@casys/mcp-server";
import { ChronoService } from "../application/service.ts";
import { errorResult } from "../domain/errors.ts";
import { PROVIDER_VERSION, type RunRequest } from "../domain/types.ts";

const objectSchema = { type: "object", additionalProperties: false } as const;
const failureSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "error"],
  properties: { ok: { const: false }, error: { type: "object" } },
} as const;
type ToolFailure = {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
  isError: true;
};
function success(
  content: string,
  structuredContent: Record<string, unknown>,
): StructuredToolResult {
  return { content, structuredContent };
}
function failure(error: unknown): ToolFailure {
  const payload = errorResult(error);
  return {
    content: [{ type: "text", text: `${payload.code}: ${payload.message}` }],
    structuredContent: { ok: false, error: payload },
    isError: true,
  };
}

export function registerChronoTools(app: McpApp, service: ChronoService): void {
  app.registerTool(
    {
      name: "chrono_manifest_get",
      description:
        "Return the provider identity, strict case contract, factual-output boundary, and non-claims.",
      inputSchema: objectSchema,
      outputSchema: {
        type: "object",
        required: ["ok", "manifest"],
        properties: { ok: { const: true }, manifest: { type: "object" } },
        additionalProperties: false,
      },
    },
    () =>
      success("Chrono prescribed-kinematics provider manifest.", {
        ok: true,
        manifest: {
          name: "@casys/mcp-chrono",
          version: PROVIDER_VERSION,
          release_status: "0.1.0 prepared; JSR package and GHCR image unpublished",
          case_schema_id: "chrono-prescribed-kinematics-case/1.0",
          input_pose_semantics:
            "absolute_com_pose and absolute_joint_frame are absolute zero-angle references; t=0 is observed after assembly applies initial_angle_rad and may differ.",
          engine: { name: "Project Chrono", required_version: "10.0.0" },
          units: { length: "m", angle: "rad", time: "s" },
          frame: "right-handed",
          authority: "explicit mechanics input to factual observations only",
          non_claims: [
            "joint inference",
            "axis inference",
            "frame inference",
            "unit inference",
            "STEP interpretation",
            "collision",
            "clearance",
            "contact",
            "forces",
            "torques",
            "dynamics",
            "strength",
            "safety",
            "product pass/fail",
          ],
        },
      }),
  );
  app.registerTool({
    name: "chrono_case_submit",
    description:
      "Validate and immutably store exact explicit prescribed-kinematics case JSON under its SHA-256 identity.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_json", "case_sha256"],
      properties: {
        case_json: { type: "string", maxLength: 524288 },
        case_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      },
    },
    outputSchema: {
      oneOf: [{
        type: "object",
        additionalProperties: false,
        required: ["ok", "case_sha256", "case_uri"],
        properties: {
          ok: { const: true },
          case_sha256: { type: "string" },
          case_uri: { type: "string" },
        },
      }, failureSchema],
    },
  }, async (args) => {
    try {
      const result = await service.submit(args.case_json, args.case_sha256);
      return success("Case stored under its content-addressed identity.", {
        ok: true,
        ...result,
      });
    } catch (error) {
      return failure(error);
    }
  });
  app.registerTool({
    name: "chrono_run_prescribed_kinematics",
    description:
      "Run a previously submitted explicit case once for a request identity; an uncertain intent is never rerun automatically.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "case_sha256"],
      properties: {
        request_id: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        },
        case_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        case_uri: { type: "string", pattern: "^chrono-case:sha256:[a-f0-9]{64}$" },
        timeout_ms: { type: "integer", minimum: 100, maximum: 60000 },
      },
    },
    outputSchema: {
      oneOf: [{
        type: "object",
        additionalProperties: false,
        required: ["ok", "replayed", "record"],
        properties: {
          ok: { const: true },
          replayed: { type: "boolean" },
          record: { type: "object" },
        },
      }, failureSchema],
    },
  }, async (args) => {
    try {
      const result = await service.run(args as unknown as RunRequest);
      return success(
        result.replayed
          ? "Recorded run result replayed exactly."
          : "Prescribed-kinematics observation recorded.",
        { ok: true, ...result },
      );
    } catch (error) {
      return failure(error);
    }
  });
  app.registerTool({
    name: "chrono_run_get",
    description:
      "Read a recorded run result or its literal uncertain intent state by request identity.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id"],
      properties: {
        request_id: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        },
      },
    },
    outputSchema: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["ok", "state"],
          properties: {
            ok: { const: true },
            state: { enum: ["recorded", "uncertain", "absent"] },
            record: { type: "object" },
            intent: { type: "object" },
          },
        },
        failureSchema,
      ],
    },
  }, async (args) => {
    try {
      const found = await service.lookup(args.request_id as string);
      return success(`Run state: ${found.state}.`, { ok: true, ...found });
    } catch (error) {
      return failure(error);
    }
  });
}
