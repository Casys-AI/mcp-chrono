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
  FocusedView,
  InlineCode,
  KeyValueList,
  NoticeGroup,
  SemanticElement,
  StateMessage,
} from "@casys/mcp-view-components/preact/components";
import type { ComponentChild } from "preact";
import { chronoMessages } from "./messages.ts";
import {
  type ChronoRunRecordView,
  type ChronoRunView,
  formatExactNumber,
} from "./model.ts";

export const CHRONO_COMPONENT_KEYS = {
  recordedRun: "chrono.recorded-run",
} as const;

type ChronoComponentProps = PreactSurfaceComponentProps<ChronoRunView>;
type ChronoTranslator = ReturnType<typeof chronoMessages>;

interface Fact {
  readonly id: string;
  readonly label: string;
  readonly value: ComponentChild;
}

const RecordedRun = ({ data, context }: ChronoComponentProps) => {
  const hostContext = context.hostContext;
  const t = chronoMessages(hostContext?.locale);
  if (data.kind === "absent") {
    return (
      <StateMessage title="absent" tone="neutral">
        {t("absentDetail")}
      </StateMessage>
    );
  }
  if (data.kind === "uncertain") {
    return (
      <StateMessage title="uncertain" tone="warning">
        {t("uncertainDetail")} {t("requestLabel")}{" "}
        <InlineCode>{data.intent.request.request_id}</InlineCode>.
      </StateMessage>
    );
  }
  const { record } = data;
  const { observation, receipt } = record;
  const notConverged = observation.execution_state === "not_converged";
  return (
    <FocusedView
      className="chrono-run-record"
      label={t("recordedRunLabel")}
      hostContext={hostContext}
      status={
        <NoticeGroup
          label={t("notEvaluated")}
          tone="neutral"
          items={[observation.not_evaluated.join(", ")]}
        />
      }
      primary={
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
          tone={notConverged ? "warning" : undefined}
          ident={
            <ElementIdent
              marker={t("recordedMarker")}
              label={t("prescribedKinematics")}
              detail={data.replayed ? t("prescribedKinematicsReplayed") : undefined}
            />
          }
          reading={[
            <ElementReading
              key="execution-state"
              label={t("executionState")}
              value={observation.execution_state}
            />,
            <ElementReading
              key="samples"
              label={t("samples")}
              value={formatExactNumber(observation.sample_count)}
            />,
            <ElementReading
              key="time-range"
              label={t("timeRange")}
              value={formatExactNumber(observation.sample_time_range_s.first) +
                " → " +
                formatExactNumber(observation.sample_time_range_s.last)}
              unit="s"
            />,
            <ElementReading
              key="kinematics-exit"
              label={t("kinematicsExit")}
              value={observation.kinematics_exit.raw_name}
              detail={t("rawCode", {
                code: formatExactNumber(observation.kinematics_exit.raw_code),
              })}
            />,
          ]}
        />
      }
      detailsLabel={t("technicalDetails")}
      details={
        <ElementBody>
          <Facts
            items={[{
              id: "request",
              label: t("requestLabel"),
              value: <InlineCode>{record.request.request_id}</InlineCode>,
            }]}
          />
          <ElementSection title={t("engine")}>
            <Facts items={engineFacts(record, t)} />
          </ElementSection>
          <ElementSection title={t("provenance")}>
            <ArtifactRow
              label={t("caseLabel")}
              kind="input"
              uri={record.case_uri}
              fingerprint={{ algorithm: "sha256", digest: record.request.case_sha256 }}
            />
            <Facts items={provenanceFacts(record, t)} />
          </ElementSection>
          <ElementSection title={t("digests")}>
            <Facts
              items={[
                {
                  id: "outcome",
                  label: t("outcome"),
                  value: digest(receipt.outcome_sha256),
                },
                {
                  id: "worker-source",
                  label: t("workerSource"),
                  value: digest(receipt.worker.source_sha256),
                },
              ]}
            />
          </ElementSection>
          <ElementProvenance
            label={t("receipt")}
            value={digest(receipt.receipt_sha256)}
          />
        </ElementBody>
      }
    />
  );
};

function engineFacts(
  { observation, receipt }: ChronoRunRecordView,
  t: ChronoTranslator,
): Fact[] {
  return [
    {
      id: "engine",
      label: t("engine"),
      value: `${observation.engine.name} ${observation.engine.version}`,
    },
    {
      id: "binding",
      label: t("binding"),
      value:
        `${observation.runtime.binding} · Python ${observation.runtime.python_version}`,
    },
    {
      id: "server",
      label: t("server"),
      value: `${receipt.package.name} ${receipt.package.version}`,
    },
    {
      id: "provider",
      label: t("provider"),
      value: `${receipt.provider.name} ${receipt.provider.version}`,
    },
    { id: "deno", label: t("deno"), value: receipt.server_runtime.deno_version },
  ];
}

function provenanceFacts(
  record: ChronoRunRecordView,
  t: ChronoTranslator,
): Fact[] {
  const facts: Fact[] = [
    { id: "recorded-at", label: t("recordedAt"), value: record.recorded_at },
  ];
  if (record.request.timeout_ms !== undefined) {
    facts.push({
      id: "timeout",
      label: t("requestedTimeout"),
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
