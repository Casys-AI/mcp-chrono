import { createTranslator } from "@casys/mcp-view-components";

/** Interface wording only. Statuses, identifiers and recorded values stay literal. */
export const CHRONO_MESSAGES_EN = {
  recordedRunLabel: "Recorded Chrono run",
  technicalDetails: "Technical details",
  recordedMarker: "Recorded",
  prescribedKinematics: "Prescribed kinematics run",
  prescribedKinematicsReplayed:
    "Prescribed kinematics run · replayed from the existing record",
  executionState: "Execution state",
  samples: "Samples",
  timeRange: "Time range",
  kinematicsExit: "Kinematics exit",
  rawCode: "raw code {code}",
  engine: "Engine",
  binding: "Binding",
  server: "Server",
  provider: "Provider",
  deno: "Deno",
  notEvaluated: "Not evaluated",
  provenance: "Provenance",
  caseLabel: "Case",
  recordedAt: "Recorded at",
  requestedTimeout: "Requested timeout",
  digests: "Digests",
  outcome: "Outcome",
  workerSource: "Worker source",
  receipt: "Receipt",
  absentDetail: "No recorded run exists for this request identity.",
  uncertainDetail:
    "Intent is persisted without a recorded observation and is never rerun automatically.",
  requestLabel: "Request",
  loadingMessage: "Receiving a Chrono run record or readback…",
  emptyMessage: "Chrono returned no supported run-record projection.",
  unresolvedTitle: "Recorded Chrono run unresolved",
  unavailableTitle: "Recorded Chrono run unavailable",
  sessionRejectedTitle: "Session rejected",
  startupTitle: "Chrono viewer unavailable",
  startupFallback: "The viewer could not start.",
} as const;

export type ChronoMessageKey = keyof typeof CHRONO_MESSAGES_EN;

export const CHRONO_MESSAGES_FR: { readonly [Key in ChronoMessageKey]: string } = {
  recordedRunLabel: "Course Chrono enregistrée",
  technicalDetails: "Détails techniques",
  recordedMarker: "Enregistré",
  prescribedKinematics: "Course en cinématique prescrite",
  prescribedKinematicsReplayed:
    "Course en cinématique prescrite · rejouée depuis l’enregistrement existant",
  executionState: "État d’exécution",
  samples: "Échantillons",
  timeRange: "Plage temporelle",
  kinematicsExit: "Sortie cinématique",
  rawCode: "code brut {code}",
  engine: "Moteur",
  binding: "Liaison",
  server: "Serveur",
  provider: "Fournisseur",
  deno: "Deno",
  notEvaluated: "Non évalué",
  provenance: "Provenance",
  caseLabel: "Cas",
  recordedAt: "Enregistré le",
  requestedTimeout: "Délai demandé",
  digests: "Empreintes",
  outcome: "Résultat",
  workerSource: "Source du worker",
  receipt: "Reçu",
  absentDetail: "Aucune course enregistrée n’existe pour cette identité de requête.",
  uncertainDetail:
    "L’intention est persistée sans observation enregistrée et n’est jamais relancée automatiquement.",
  requestLabel: "Requête",
  loadingMessage: "Réception d’un enregistrement ou d’une relecture Chrono…",
  emptyMessage:
    "Chrono n’a renvoyé aucune projection d’enregistrement prise en charge.",
  unresolvedTitle: "Course Chrono enregistrée non résolue",
  unavailableTitle: "Course Chrono enregistrée indisponible",
  sessionRejectedTitle: "Session rejetée",
  startupTitle: "Visionneuse Chrono indisponible",
  startupFallback: "La visionneuse n’a pas pu démarrer.",
};

/** Host locale in, interface strings out. Invalid or absent locales use English. */
export const chronoMessages = createTranslator({
  defaultLocale: "en",
  messages: CHRONO_MESSAGES_EN,
  translations: { fr: CHRONO_MESSAGES_FR },
});
