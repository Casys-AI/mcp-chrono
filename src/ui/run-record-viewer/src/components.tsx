/** @jsxImportSource preact */

import {
  defineComponentRegistry,
  defineComponentSurface,
} from "@casys/mcp-view-components";
import {
  definePreactComponent,
  type PreactSurfaceComponentProps,
  type PreactSurfaceContext,
} from "@casys/mcp-view-components/preact";
import {
  Badge,
  Card,
  DataTable,
  ElementBody,
  ElementIdent,
  ElementProvenance,
  ElementReading,
  InlineCode,
  KeyValueList,
  MetricGrid,
  SemanticElement,
  Stack,
  StateMessage,
} from "@casys/mcp-view-components/preact/components";
import {
  type ChronoKinematicsSample,
  type ChronoRunView,
  formatExactNumber,
  formatExactVector,
  isRecordedRun,
} from "./model.ts";

export const CHRONO_COMPONENT_KEYS = {
  runSummary: "chrono.run-summary",
  samplePage: "chrono.sample-page",
  executionFacts: "chrono.execution-facts",
  receiptProvenance: "chrono.receipt-provenance",
} as const;

type ChronoComponentProps = PreactSurfaceComponentProps<ChronoRunView>;

const RunSummary = ({ data }: ChronoComponentProps) => {
  if (data.kind === "absent") {
    return (
      <StateMessage title="absent" tone="neutral">
        No recorded run exists for this request identity.
      </StateMessage>
    );
  }
  if (data.kind === "uncertain") {
    return (
      <StateMessage title="uncertain" tone="warning">
        Intent is persisted without a recorded observation and is never rerun
        automatically. request_id{" "}
        <InlineCode>{data.intent.request.request_id}</InlineCode>. case_uri{" "}
        <InlineCode>{data.intent.case_uri}</InlineCode>. intent_recorded_at{" "}
        <InlineCode>{data.intent.intent_recorded_at}</InlineCode>.
      </StateMessage>
    );
  }
  const { record, replayed } = data;
  const observation = record.observation;
  return (
    <SemanticElement
      reference={{
        domain: "chrono",
        kind: "run-record",
        id: record.request.request_id,
        basisFingerprint: record.receipt.receipt_sha256,
      }}
      density="card"
      ident={
        <ElementIdent
          marker={observation.execution_state}
          label={<InlineCode>{record.request.request_id}</InlineCode>}
          detail={replayed === true
            ? (
              <>
                replayed · <InlineCode>{record.case_uri}</InlineCode>
              </>
            )
            : <InlineCode>{record.case_uri}</InlineCode>}
        />
      }
      reading={[
        <ElementReading
          key="sample-count"
          label="sample_count"
          value={formatExactNumber(observation.sample_count)}
        />,
        <ElementReading
          key="first-time"
          label="sample_time_range_s.first"
          value={formatExactNumber(observation.sample_time_range_s.first)}
        />,
        <ElementReading
          key="last-time"
          label="sample_time_range_s.last"
          value={formatExactNumber(observation.sample_time_range_s.last)}
        />,
      ]}
      body={
        <ElementBody>
          <KeyValueList
            items={[
              {
                id: "execution-state",
                label: "execution_state",
                value: observation.execution_state,
              },
              {
                id: "kinematics-exit",
                label: "kinematics_exit",
                value:
                  `${observation.kinematics_exit.raw_code}/${observation.kinematics_exit.raw_name}`,
              },
            ]}
          />
        </ElementBody>
      }
      provenance={
        <ElementProvenance
          label="receipt_sha256"
          value={<InlineCode>{record.receipt.receipt_sha256}</InlineCode>}
        />
      }
    />
  );
};

const SamplePage = ({ data }: ChronoComponentProps) => {
  if (!isRecordedRun(data)) {
    return (
      <StateMessage title="No bounded sample page" tone="neutral">
        Sample pages exist only on a recorded observation.
      </StateMessage>
    );
  }
  const page = data.record.sample_page;
  return (
    <Card
      title="Bounded sample page"
      eyebrow="MCP result page, not the durable ledger"
      actions={
        <Badge tone={page.has_more ? "info" : "neutral"}>
          {page.has_more ? "has_more" : "complete page"}
        </Badge>
      }
    >
      <Stack gap="sm">
        <KeyValueList
          items={[
            { id: "offset", label: "offset", value: formatExactNumber(page.offset) },
            { id: "limit", label: "limit", value: formatExactNumber(page.limit) },
            { id: "total", label: "total", value: formatExactNumber(page.total) },
            {
              id: "returned",
              label: "returned",
              value: formatExactNumber(page.returned),
            },
            { id: "has-more", label: "has_more", value: String(page.has_more) },
          ]}
        />
        <DataTable<ChronoKinematicsSample>
          label="Paged kinematics samples"
          rows={page.samples}
          rowKey={(sample) =>
            `${formatExactNumber(sample.time_s)}:${
              sample.bodies.map((body) => body.id).join(",")
            }`}
          emptyLabel="This page contains no samples."
          columns={[
            {
              id: "time_s",
              label: "time_s",
              render: (sample) => formatExactNumber(sample.time_s),
            },
            {
              id: "bodies",
              label: "bodies",
              render: (sample) =>
                sample.bodies.map((body) =>
                  `${body.id} ${formatExactVector(body.position_m)} ${
                    formatExactVector(body.rotation_wxyz)
                  }`
                ).join("; "),
            },
            {
              id: "motors",
              label: "motors",
              render: (sample) =>
                sample.motors.length === 0
                  ? "none"
                  : sample.motors.map((motor) =>
                    `${motor.joint_id} ${
                      formatExactNumber(motor.motor_angle_rad)
                    } ${motor.declared_limit_observation}`
                  ).join("; "),
            },
          ]}
        />
      </Stack>
    </Card>
  );
};

const ExecutionFacts = ({ data }: ChronoComponentProps) => {
  if (!isRecordedRun(data)) {
    return (
      <StateMessage title="No execution facts" tone="neutral">
        Execution facts exist only on a recorded observation.
      </StateMessage>
    );
  }
  const observation = data.record.observation;
  return (
    <Card title="Execution facts" eyebrow="Factual engine state, not a verdict">
      <Stack gap="sm">
        <MetricGrid
          items={[
            {
              id: "execution-state",
              label: "execution_state",
              value: observation.execution_state,
              tone: "info",
            },
            {
              id: "kinematics-code",
              label: "kinematics_exit.raw_code",
              value: formatExactNumber(observation.kinematics_exit.raw_code),
            },
            {
              id: "kinematics-name",
              label: "kinematics_exit.raw_name",
              value: observation.kinematics_exit.raw_name,
            },
            {
              id: "sample-count",
              label: "sample_count",
              value: formatExactNumber(observation.sample_count),
            },
          ]}
        />
        <KeyValueList
          items={[
            {
              id: "engine",
              label: "engine",
              value: `${observation.engine.name} ${observation.engine.version}`,
            },
            {
              id: "runtime",
              label: "runtime",
              value:
                `${observation.runtime.binding} ${observation.runtime.python_version}`,
            },
            {
              id: "not-evaluated",
              label: "not_evaluated",
              value: observation.not_evaluated.join(", "),
            },
          ]}
        />
      </Stack>
    </Card>
  );
};

const ReceiptProvenance = ({ data }: ChronoComponentProps) => {
  if (!isRecordedRun(data)) {
    return (
      <StateMessage title="No receipt provenance" tone="neutral">
        Receipt provenance exists only on a recorded observation.
      </StateMessage>
    );
  }
  const receipt = data.record.receipt;
  return (
    <Card
      title="Receipt provenance"
      eyebrow="Factual identity, never a product verdict"
    >
      <KeyValueList
        items={[
          {
            id: "schema",
            label: "schema_id",
            value: <InlineCode>{receipt.schema_id}</InlineCode>,
          },
          {
            id: "receipt-sha",
            label: "receipt_sha256",
            value: <InlineCode>{receipt.receipt_sha256}</InlineCode>,
          },
          {
            id: "case-sha",
            label: "case_sha256",
            value: <InlineCode>{receipt.case_sha256}</InlineCode>,
          },
          {
            id: "outcome-sha",
            label: "outcome_sha256",
            value: <InlineCode>{receipt.outcome_sha256}</InlineCode>,
          },
          {
            id: "request-id",
            label: "request_id",
            value: <InlineCode>{receipt.request_id}</InlineCode>,
          },
          {
            id: "recorded-at",
            label: "recorded_at",
            value: <InlineCode>{receipt.recorded_at}</InlineCode>,
          },
          {
            id: "package",
            label: "package",
            value: `${receipt.package.name} ${receipt.package.version}`,
          },
          {
            id: "provider",
            label: "provider",
            value: `${receipt.provider.name} ${receipt.provider.version}`,
          },
          {
            id: "worker",
            label: "worker.source_sha256",
            value: <InlineCode>{receipt.worker.source_sha256}</InlineCode>,
          },
          {
            id: "runtime",
            label: "runtime",
            value: `${receipt.runtime.binding} ${receipt.runtime.python_version}`,
          },
          {
            id: "server-runtime",
            label: "server_runtime.deno_version",
            value: receipt.server_runtime.deno_version,
          },
          {
            id: "execution-state",
            label: "execution_state",
            value: receipt.execution_state,
          },
          {
            id: "kinematics-exit",
            label: "kinematics_exit",
            value:
              `${receipt.kinematics_exit.raw_code}/${receipt.kinematics_exit.raw_name}`,
          },
        ]}
      />
    </Card>
  );
};

/** Standalone default: one compact run-record card, not a four-pane dashboard. */
export const CHRONO_RUN_RECORD_SURFACE = defineComponentSurface({
  layout: { type: "stack", gap: "sm" },
  components: [{
    id: "run-summary",
    component: CHRONO_COMPONENT_KEYS.runSummary,
  }],
});

export const CHRONO_COMPONENT_REGISTRY = defineComponentRegistry<
  ChronoRunView,
  PreactSurfaceContext<ChronoRunView>
>({
  components: {
    [CHRONO_COMPONENT_KEYS.runSummary]: definePreactComponent(
      {
        title: "Run summary",
        description:
          "One compact prescribed-kinematics run record: request identity, literal execution_state, bounded sample counts and receipt SHA-256.",
      },
      RunSummary,
    ),
    [CHRONO_COMPONENT_KEYS.samplePage]: definePreactComponent(
      {
        title: "Bounded sample page",
        description:
          "The MCP sample_page only: paging facts plus the returned samples, never the durable observation.",
      },
      SamplePage,
    ),
    [CHRONO_COMPONENT_KEYS.executionFacts]: definePreactComponent(
      {
        title: "Execution facts",
        description:
          "Engine, runtime, kinematics_exit and the literal not_evaluated list. Solver SUCCESS is an exit name, not a proof.",
      },
      ExecutionFacts,
    ),
    [CHRONO_COMPONENT_KEYS.receiptProvenance]: definePreactComponent(
      {
        title: "Receipt provenance",
        description:
          "Canonical 0.3.2 receipt fields as recorded. Provenance is factual identity, never a product verdict.",
      },
      ReceiptProvenance,
    ),
  },
  defaultSurface: CHRONO_RUN_RECORD_SURFACE,
});
