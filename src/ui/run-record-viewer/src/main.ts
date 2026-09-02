import { renderStartupFailure, startChronoRunRecordApp } from "./app.ts";

const root = document.getElementById("root");
if (!root) throw new Error("The Chrono run-record viewer root is missing.");

void startChronoRunRecordApp(root).catch((error) => {
  root.replaceChildren(renderStartupFailure(error));
  root.setAttribute("aria-busy", "false");
  console.error(error);
});
