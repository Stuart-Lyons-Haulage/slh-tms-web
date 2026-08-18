import { useMemo, useState, type ChangeEvent } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";

type ImportStop = {
  sequence?: number;
  collectionSite?: string;
  deliverySite?: string;
  pallets?: number;
  palletType?: string;
};

type ImportRun = {
  runRef?: string;
  plannerRun?: string;
  runType?: string;
  planningDate?: string;
  driver?: string;
  vehicle?: string;
  trailer?: string;
  includeInImport?: boolean;
  reconciliationStatus?: string;
  capacityStatus?: string;
  mixedUtilisationPercent?: number;
  stops?: ImportStop[];
};

type PlannerPlanPayload = {
  schema?: string;
  planningDate?: string;
  runs?: ImportRun[];
  exceptions?: Array<{ severity?: string; runRef?: string; code?: string; detail?: string }>;
};

type ImportRunResult = {
  runRef: string;
  tmsReference: string;
  outcome: string;
  capacityStatus: string;
  utilisationPercent: number;
  detail?: string;
};

type ImportSummary = {
  planningDate: string;
  received: number;
  created: number;
  updated: number;
  unchanged: number;
  held: number;
  warnings: string[];
  unresolvedDrivers: string[];
  unresolvedVehicles: string[];
  unresolvedTrailers: string[];
  runs: ImportRunResult[];
};

function safeRuns(payload?: PlannerPlanPayload) {
  return Array.isArray(payload?.runs) ? payload!.runs! : [];
}

export function PlannerPlanImport() {
  const token = useAccessToken();
  const [fileName, setFileName] = useState("");
  const [payload, setPayload] = useState<PlannerPlanPayload>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary>();

  const preview = useMemo(() => {
    const runs = safeRuns(payload);
    const included = runs.filter((run) => run.includeInImport !== false);
    const held = runs.filter((run) => run.includeInImport === false);
    const red = included.filter((run) => String(run.capacityStatus || "").toLowerCase() === "red");
    const amber = included.filter((run) => String(run.capacityStatus || "").toLowerCase() === "amber");
    const stops = included.reduce((total, run) => total + (Array.isArray(run.stops) ? run.stops.length : 0), 0);
    return { total: runs.length, included: included.length, held: held.length, red: red.length, amber: amber.length, stops };
  }, [payload]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    setSummary(undefined);
    setPayload(undefined);
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = JSON.parse(await file.text()) as PlannerPlanPayload;
      if (!parsed || typeof parsed !== "object") throw new Error("The selected file is not a planner JSON object.");
      if (!parsed.planningDate || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.planningDate)) throw new Error("The planner file needs a valid planningDate (YYYY-MM-DD).");
      if (!Array.isArray(parsed.runs) || parsed.runs.length === 0) throw new Error("The planner file contains no runs.");
      const duplicateRefs = parsed.runs.map((run) => String(run.runRef || "").trim().toUpperCase()).filter(Boolean)
        .filter((ref, index, refs) => refs.indexOf(ref) !== index);
      if (duplicateRefs.length) throw new Error(`Duplicate run reference in file: ${duplicateRefs[0]}.`);
      if (parsed.runs.some((run) => !String(run.runRef || "").trim())) throw new Error("Every planner run must have a runRef.");
      if (parsed.runs.some((run) => run.planningDate && run.planningDate !== parsed.planningDate)) throw new Error("One or more runs use a different planning date from the file header.");
      setPayload(parsed);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The planner file could not be read.");
    }
  }

  async function importPlan() {
    if (!payload || busy) return;
    const date = payload.planningDate;
    const confirmation = window.confirm(
      `Import planner plan for ${date}?\n\n${preview.included} runs will be submitted. ${preview.held} held/excluded runs will remain excluded.\n\nThis is idempotent: re-importing the same run/date updates the existing TMS run rather than creating a duplicate.`,
    );
    if (!confirmation) return;
    setBusy(true);
    setError(undefined);
    setSummary(undefined);
    try {
      const result = await request<ImportSummary>(
        "/api/v1/planning/import-plan",
        await token(),
        { method: "POST", body: JSON.stringify(payload) },
        120000,
      );
      setSummary(result);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The planner plan could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  return <section>
    <div className="page-heading">
      <div>
        <p className="eyebrow">Planner control</p>
        <h1>Import planner plan</h1>
        <p>Load the reconciled planner JSON, review the control totals, then confirm the authenticated import into the TMS.</p>
      </div>
    </div>

    <div className="card" style={{ maxWidth: 1100, display: "grid", gap: 18 }}>
      <div>
        <label style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <strong>Planner JSON file</strong>
          <input type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event)} disabled={busy} />
        </label>
        {fileName && <p><strong>Selected:</strong> {fileName}</p>}
      </div>

      {payload && <>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span className="badge"><strong>{payload.planningDate}</strong> planning date</span>
          <span className="badge"><strong>{preview.total}</strong> source runs</span>
          <span className="badge"><strong>{preview.included}</strong> to import</span>
          <span className="badge"><strong>{preview.held}</strong> held / excluded</span>
          <span className="badge"><strong>{preview.stops}</strong> stops</span>
          <span className="badge"><strong>{preview.red}</strong> red capacity warnings</span>
          <span className="badge"><strong>{preview.amber}</strong> amber capacity checks</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Run</th><th>Type</th><th>Driver</th><th>Vehicle</th><th>Trailer</th><th>Stops</th><th>Capacity</th><th>Import</th><th>Reconciliation</th></tr></thead>
            <tbody>{safeRuns(payload).map((run, index) => <tr key={`${run.runRef}-${index}`}>
              <td><strong>{run.runRef || "—"}</strong></td>
              <td>{run.runType || "—"}</td>
              <td>{run.driver || "Unallocated"}</td>
              <td>{run.vehicle || "—"}</td>
              <td>{run.trailer || "—"}</td>
              <td>{Array.isArray(run.stops) ? run.stops.length : 0}</td>
              <td>{run.capacityStatus || "—"}{typeof run.mixedUtilisationPercent === "number" ? ` · ${run.mixedUtilisationPercent.toFixed(1)}%` : ""}</td>
              <td>{run.includeInImport === false ? "Held" : "Yes"}</td>
              <td>{run.reconciliationStatus || "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="primary" disabled={busy || preview.included === 0} onClick={() => void importPlan()}>{busy ? "Importing…" : `Confirm import of ${preview.included} runs`}</button>
          <span>Held/cancelled rows are submitted for control only and are not created as live runs.</span>
        </div>
      </>}

      {error && <p className="notice inline-notice">{error}</p>}

      {summary && <div style={{ display: "grid", gap: 14 }}>
        <h2>Import complete · {summary.planningDate}</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span className="badge"><strong>{summary.created}</strong> created</span>
          <span className="badge"><strong>{summary.updated}</strong> updated</span>
          <span className="badge"><strong>{summary.unchanged}</strong> unchanged</span>
          <span className="badge"><strong>{summary.held}</strong> held</span>
        </div>
        {(summary.unresolvedDrivers.length > 0 || summary.unresolvedVehicles.length > 0 || summary.unresolvedTrailers.length > 0) && <div className="notice inline-notice">
          <strong>Master-data matching still required.</strong>
          {summary.unresolvedDrivers.length > 0 && <div>Drivers: {summary.unresolvedDrivers.join(", ")}</div>}
          {summary.unresolvedVehicles.length > 0 && <div>Vehicles: {summary.unresolvedVehicles.join(", ")}</div>}
          {summary.unresolvedTrailers.length > 0 && <div>Trailers: {summary.unresolvedTrailers.join(", ")}</div>}
        </div>}
        {summary.warnings.length > 0 && <div><strong>Warnings</strong><ul>{summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
        <p><a href="/">Open Planner →</a> · <a href="/loads">Open Runs →</a></p>
      </div>}
    </div>
  </section>;
}
