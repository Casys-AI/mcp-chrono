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
  ElementBody,
  ElementIdent,
  ElementProvenance,
  InlineCode,
  KeyValueList,
  MetricGrid,
  SemanticElement,
  StateMessage,
} from "@casys/mcp-view-components/preact/components";
import { type ChronoRunView, formatExactNumber } from "./model.ts";

export const CHRONO_COMPONENT_KEYS = {
  recordedRun: "chrono.recorded-run",
} as const;

type ChronoComponentProps = PreactSurfaceComponentProps<ChronoRunView>;

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
        automatically. request_id{" "}
        <InlineCode>{data.intent.request.request_id}</InlineCode>.
      </StateMessage>
    );
  }
  const { record } = data;
  const observation = record.observation;
  return (
    <SemanticElement
      className="chrono-run-record-card"
      reference={{
        domain: "chrono",
        kind: "recorded-run",
        id: record.request.request_id,
        basisFingerprint: record.receipt.receipt_sha256,
      }}
      density="card"
      ident={
        <ElementIdent
          marker="Recorded"
          label={<InlineCode>{record.request.request_id}</InlineCode>}
          detail={"Prescribed kinematics · " + observation.execution_state}
        />
      }
      body={
        <ElementBody>
          <MetricGrid
            className="chrono-run-readings"
            items={[
              {
                id: "sample-count",
                label: "sample_count",
                value: formatExactNumber(observation.sample_count),
              },
              {
                id: "sample-time-range",
                label: "sample_time_range_s",
                value: formatExactNumber(
                  observation.sample_time_range_s.first,
                ) + " → " +
                  formatExactNumber(observation.sample_time_range_s.last),
                unit: "s",
              },
            ]}
          />
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
                value: formatExactNumber(
                  observation.kinematics_exit.raw_code,
                ) + "/" + observation.kinematics_exit.raw_name,
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
