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
  ArtifactRow,
  ElementBody,
  ElementIdent,
  ElementProvenance,
  ElementReading,
  ElementSection,
  InlineCode,
  KeyValueList,
  NoticeGroup,
  SemanticElement,
  StateMessage,
} from "@casys/mcp-view-components/preact/components";
import type { ComponentChild } from "preact";
import {
  type ChronoRunRecordView,
  type ChronoRunView,
  formatExactNumber,
} from "./model.ts";

export const CHRONO_COMPONENT_KEYS = {
  recordedRun: "chrono.recorded-run",
} as const;

type ChronoComponentProps = PreactSurfaceComponentProps<ChronoRunView>;

interface Fact {
  readonly id: string;
  readonly label: string;
  readonly value: ComponentChild;
}

const RecordedRun = ({ data }: ChronoComponentProps) => {
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
        automatically. Request{" "}
        <InlineCode>{data.intent.request.request_id}</InlineCode>.
      </StateMessage>
    );
  }
  const { record } = data;
  const { observation, receipt } = record;
  return (
    <SemanticElement
      className="chrono-run-record-card"
      reference={{
        domain: "chrono",
        kind: "recorded-run",
        id: record.request.request_id,
        basisFingerprint: receipt.receipt_sha256,
      }}
      density="card"
      // The engine's own state is the only thing that colours the sheet.
      tone={observation.execution_state === "not_converged" ? "warning" : undefined}
      ident={
        <ElementIdent
          marker="Recorded"
          label={<InlineCode>{record.request.request_id}</InlineCode>}
          detail={data.replayed
            ? "Prescribed kinematics run · replayed from the existing record"
            : "Prescribed kinematics run"}
        />
      }
      reading={[
        <ElementReading
          key="execution-state"
          label="Execution state"
          value={observation.execution_state}
        />,
        <ElementReading
          key="samples"
          label="Samples"
          value={formatExactNumber(observation.sample_count)}
        />,
        <ElementReading
          key="time-range"
          label="Time range"
          value={formatExactNumber(observation.sample_time_range_s.first) + " → " +
            formatExactNumber(observation.sample_time_range_s.last)}
          unit="s"
        />,
        <ElementReading
          key="kinematics-exit"
          label="Kinematics exit"
          value={observation.kinematics_exit.raw_name}
          detail={`raw code ${formatExactNumber(observation.kinematics_exit.raw_code)}`}
        />,
      ]}
      body={
        <ElementBody>
          <ElementSection title="Engine">
            <Facts items={engineFacts(record)} />
          </ElementSection>
          <NoticeGroup
            label="Not evaluated"
            tone="neutral"
            items={[observation.not_evaluated.join(", ")]}
          />
          <ElementSection title="Provenance">
            <ArtifactRow
              label="Case"
              kind="input"
              uri={record.case_uri}
              fingerprint={{ algorithm: "sha256", digest: record.request.case_sha256 }}
            />
            <Facts items={provenanceFacts(record)} />
          </ElementSection>
          <ElementSection title="Digests">
            <Facts
              items={[
                {
                  id: "outcome",
                  label: "Outcome",
                  value: digest(receipt.outcome_sha256),
                },
                {
                  id: "worker-source",
                  label: "Worker source",
                  value: digest(receipt.worker.source_sha256),
                },
              ]}
            />
          </ElementSection>
        </ElementBody>
      }
      provenance={
        <ElementProvenance
          label="Receipt"
          value={digest(receipt.receipt_sha256)}
        />
      }
    />
  );
};

function engineFacts({ observation, receipt }: ChronoRunRecordView): Fact[] {
  return [
    {
      id: "engine",
      label: "Engine",
      value: `${observation.engine.name} ${observation.engine.version}`,
    },
    {
      id: "binding",
      label: "Binding",
      value:
        `${observation.runtime.binding} · Python ${observation.runtime.python_version}`,
    },
    {
      id: "server",
      label: "Server",
      value: `${receipt.package.name} ${receipt.package.version}`,
    },
    {
      id: "provider",
      label: "Provider",
      value: `${receipt.provider.name} ${receipt.provider.version}`,
    },
    { id: "deno", label: "Deno", value: receipt.server_runtime.deno_version },
  ];
}

function provenanceFacts(record: ChronoRunRecordView): Fact[] {
  const facts: Fact[] = [
    { id: "recorded-at", label: "Recorded at", value: record.recorded_at },
  ];
  if (record.request.timeout_ms !== undefined) {
    facts.push({
      id: "timeout",
      label: "Requested timeout",
      value: `${formatExactNumber(record.request.timeout_ms)} ms`,
    });
  }
  return facts;
}

/** Reader-worded facts in two columns; the inspector layout is for field dumps. */
function Facts({ items }: { readonly items: readonly Fact[] }) {
  return <KeyValueList layout="facts" items={items} />;
}

function digest(value: string): ComponentChild {
  return <InlineCode>{value}</InlineCode>;
}

/** Standalone default: exactly one recorded-run business component. */
export const CHRONO_RUN_RECORD_SURFACE = defineComponentSurface({
  layout: { type: "stack", gap: "none" },
  components: [{
    id: "recorded-run",
    component: CHRONO_COMPONENT_KEYS.recordedRun,
  }],
});

/** Private registry used to render the App-owned whole view. */
export const CHRONO_COMPONENT_REGISTRY = defineComponentRegistry<
  ChronoRunView,
  PreactSurfaceContext<ChronoRunView>
>({
  components: {
    [CHRONO_COMPONENT_KEYS.recordedRun]: definePreactComponent(
      {
        title: "Recorded Chrono run",
        description:
          "One exact prescribed-kinematics run identity with literal execution facts and receipt provenance.",
      },
      RecordedRun,
    ),
  },
  defaultSurface: CHRONO_RUN_RECORD_SURFACE,
});
