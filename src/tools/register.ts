import { type McpApp, type StructuredToolResult } from "@casys/mcp-server";
import { ChronoService } from "../application/service.ts";
import {
  AGENT_WORKFLOW,
  CASE_INVARIANTS,
  CASE_JSON_SCHEMA,
  CASE_TEMPLATE,
  DEFAULT_SAMPLE_PAGE_LIMIT,
  INPUT_POSE_SEMANTICS,
  MAX_CASE_JSON_BYTES,
  MAX_SAMPLE_PAGE_LIMIT,
  MAX_SAMPLE_PAGE_OFFSET,
  NON_CLAIMS,
  RECEIPT_CONTRACT,
  RESULT_PAGING_CONTRACT,
  SUBMISSION_CONTRACT,
} from "../domain/contract.ts";
import { errorResult } from "../domain/errors.ts";
import { normalizeSamplePageRequest } from "../domain/result-view.ts";
import { PROVIDER_VERSION, type RunRequest } from "../domain/types.ts";
import { CHRONO_RUN_RECORD_VIEWER_URI } from "../ui/register.ts";
import {
  caseGetOutputSchema,
  caseSubmitOutputSchema,
  manifestOutputSchema,
  receiptGetOutputSchema,
  runGetOutputSchema,
  runOutputSchema,
  templateOutputSchema,
} from "./schemas.ts";

const runRecordUiMeta = {
  ui: { resourceUri: CHRONO_RUN_RECORD_VIEWER_URI },
} as const;

const objectSchema = { type: "object", additionalProperties: false } as const;
type ToolFailure = {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
  isError: true;
};
const samplePageProperties = {
  sample_offset: {
    description:
      `Zero-based stored sample offset; the handler requires a safe integer from 0 through ${MAX_SAMPLE_PAGE_OFFSET}. Omit for the first bounded result page.`,
  },
  sample_limit: {
    description:
      `Maximum samples in this response; the handler requires a safe integer from 1 through ${MAX_SAMPLE_PAGE_LIMIT}. Omit for ${DEFAULT_SAMPLE_PAGE_LIMIT}.`,
  },
} as const;
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
        "Read first: return the complete 1.0 case JSON Schema, exact template, SI units, server invariants, result paging contract, and factual-output boundary.",
      inputSchema: objectSchema,
      outputSchema: manifestOutputSchema,
    },
    () =>
      success("Chrono prescribed-kinematics provider manifest.", {
        ok: true,
        manifest: {
          name: "@casys/mcp-chrono",
          version: PROVIDER_VERSION,
          case_schema_id: "chrono-prescribed-kinematics-case/1.0",
          case_contract: {
            json_schema: CASE_JSON_SCHEMA,
            example_case: CASE_TEMPLATE,
            invariants: CASE_INVARIANTS,
          },
          input_pose_semantics: INPUT_POSE_SEMANTICS,
          engine: { name: "Project Chrono", required_version: "10.0.0" },
          units: { length: "m", angle: "rad", time: "s" },
          frame: "right-handed",
          authority: "explicit mechanics input to factual observations only",
          submission: SUBMISSION_CONTRACT,
          result_paging: RESULT_PAGING_CONTRACT,
          receipt: RECEIPT_CONTRACT,
          agent_workflow: AGENT_WORKFLOW,
          non_claims: NON_CLAIMS,
        },
      }),
  );
  app.registerTool(
    {
      name: "chrono_case_template_get",
      description:
        "Return a non-executing valid 1.0 revolute-ramp case template and its server-enforced invariants. Use it to construct an explicit case; it neither stores nor runs anything.",
      inputSchema: objectSchema,
      outputSchema: templateOutputSchema,
    },
    () =>
      success("Non-executing Chrono 1.0 case template.", {
        ok: true,
        case_schema_id: CASE_JSON_SCHEMA.$id,
        example_case: CASE_TEMPLATE,
        invariants: CASE_INVARIANTS,
      }),
  );
  app.registerTool({
    name: "chrono_case_submit",
    description:
      "Validate and immutably store exact explicit prescribed-kinematics case JSON. case_sha256 is an optional expected digest; the server always returns its computed content identity.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_json"],
      properties: {
        case_json: {
          type: "string",
          maxLength: MAX_CASE_JSON_BYTES,
          description:
            "Exact UTF-8 JSON text for the closed 1.0 case, at most 524288 bytes (512 KiB).",
        },
        case_sha256: {
          type: "string",
          pattern: "^[a-f0-9]{64}$",
          description:
            "Optional expected SHA-256 of exact case_json UTF-8 bytes. A mismatch fails closed and returns the server-computed digest in error details.",
        },
      },
    },
    outputSchema: caseSubmitOutputSchema,
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
    name: "chrono_case_get",
    description:
      "Read exact UTF-8 case bytes by their content-addressed SHA-256. This is a readback of a submitted explicit case, not an inferred or reconstructed mechanics model.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["case_sha256"],
      properties: { case_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } },
    },
    outputSchema: caseGetOutputSchema,
  }, async (args) => {
    try {
      return success("Exact submitted case read by content identity.", {
        ok: true,
        ...await service.readCase(args.case_sha256 as string),
      });
    } catch (error) {
      return failure(error);
    }
  });
  app.registerTool({
    name: "chrono_run_prescribed_kinematics",
    description:
      "Run a previously submitted explicit case once for a request identity. Return a bounded sample page only. This development source reads only an exact 0.3.4 receipt identity; another persisted version is unsupported/corrupt. An uncertain intent is never rerun automatically.",
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
        ...samplePageProperties,
      },
    },
    outputSchema: runOutputSchema,
    _meta: runRecordUiMeta,
  }, async (args) => {
    try {
      const { sample_offset, sample_limit, ...request } = args as Record<
        string,
        unknown
      >;
      const page = normalizeSamplePageRequest({ sample_offset, sample_limit });
      const result = await service.run(request as unknown as RunRequest);
      return success(
        result.replayed
          ? "Recorded run result replayed exactly as a bounded result page."
          : "Prescribed-kinematics observation recorded with a bounded result page.",
        {
          ok: true,
          replayed: result.replayed,
          record: service.viewRecord(result.record, page),
        },
      );
    } catch (error) {
      return failure(error);
    }
  });
  app.registerTool({
    name: "chrono_run_get",
    description:
      "Read a recorded run summary plus one bounded sample page, or its literal uncertain/absent state. This development source reads only an exact 0.3.4 receipt identity. Advance sample_offset while sample_page.has_more is true.",
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
        ...samplePageProperties,
      },
    },
    outputSchema: runGetOutputSchema,
    _meta: runRecordUiMeta,
  }, async (args) => {
    try {
      const page = normalizeSamplePageRequest({
        sample_offset: args.sample_offset,
        sample_limit: args.sample_limit,
      });
      const found = await service.lookupView(args.request_id as string, page);
      return success(`Run state: ${found.state}.`, { ok: true, ...found });
    } catch (error) {
      return failure(error);
    }
  });
  app.registerTool({
    name: "chrono_run_receipt_get",
    description:
      "Read an exact 0.3.4 recorded run by its canonical receipt SHA-256. Another persisted version is unsupported/corrupt. Return factual receipt provenance plus one bounded sample page; advance sample_offset while sample_page.has_more is true.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["receipt_sha256"],
      properties: {
        receipt_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        ...samplePageProperties,
      },
    },
    outputSchema: receiptGetOutputSchema,
    _meta: runRecordUiMeta,
  }, async (args) => {
    try {
      const page = normalizeSamplePageRequest({
        sample_offset: args.sample_offset,
        sample_limit: args.sample_limit,
      });
      return success("Recorded run read by canonical receipt identity.", {
        ok: true,
        record: await service.lookupReceiptView(args.receipt_sha256 as string, page),
      });
    } catch (error) {
      return failure(error);
    }
  });
}
