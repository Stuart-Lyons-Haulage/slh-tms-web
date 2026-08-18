import { useMemo, useState, type ChangeEvent } from "react";
import { useAccessToken } from "../lib/auth";
import { formatDate } from "../lib/dateUtils";

type ImportStop = {
  sequence?: number;
  collectionSite?: string;
  deliverySite?: string;
  pallets?: number;
  palletType?: string;
  collectFrom?: string;
  collectTo?: string;
  deadline?: string;
  collectionSiteArrDate?: string;
  collectionSiteArrTime?: string;
  despatchedDate?: string;
  despatchedTime?: string;
  deliveredDate?: string;
  deliveryArrivalTime?: string;
  deliveryDepartTime?: string;
  reasonForLate?: string;
};
type ImportRun = { runRef?: string; plannerRun?: string; runType?: string; planningDate?: string; driver?: string; vehicle?: string; trailer?: string; includeInImport?: boolean; reconciliationStatus?: string; capacityStatus?: string; mixedUtilisationPercent?: number; stops?: ImportStop[] };
type PlannerPlanPayload = { schema?: string; planningDate?: string; runs?: ImportRun[]; exceptions?: Array<{ severity?: string; runRef?: string; code?: string; detail?: string }> };
type ImportRunResult = { runRef: string; tmsReference: string; outcome: string; capacityStatus: string; utilisationPercent: number; detail?: string };
type ImportSummary = { planningDate: string; received: number; created: number; updated: number; unchanged: number; held: number; warnings: string[]; unresolvedDrivers: string[]; unresolvedVehicles: string[]; unresolvedTrailers: string[]; runs: ImportRunResult[] };

function safeRuns(payload?: PlannerPlanPayload) { return Array.isArray(payload?.runs) ? payload!.runs! : []; }
function clean(value?: string) { return String(value || "").trim(); }
function sortedTimes(values: Array<string | undefined>) { return values.map(clean).filter(Boolean).sort((a, b) => a.localeCompare(b)); }
function firstCollect(run: ImportRun) {
  const from = sortedTimes((run.stops || []).map((stop) => stop.collectFrom))[0];
  const to = sortedTimes((run.stops || []).filter((stop) => clean(stop.collectFrom) === from).map((stop) => stop.collectTo))[0];
  return from ? `${from}${to ? `-${to}` : ""}` : "—";
}
function finalDeadline(run: ImportRun) { return sortedTimes((run.stops || []).map((stop) => stop.deadline)).at(-1) || "—"; }
function manualActualCount(run: ImportRun) {
  return (run.stops || []).filter((stop) => clean(stop.collectionSiteArrTime) || clean(stop.despatchedTime) || clean(stop.deliveryArrivalTime) || clean(stop.deliveryDepartTime) || clean(stop.reasonForLate)).length;
}

async function readError(response: Response) {
  const raw = await response.text();
  if (!raw) return `Request failed (${response.status}).`;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const errors = parsed.errors && typeof parsed.errors === "object"
      ? Object.entries(parsed.errors as Record<string, unknown>).flatMap(([field, value]) => Array.isArray(value) ? value.map((item) => `${field}: ${String(item)}`) : [`${field}: ${String(value)}`])
      : [];
    return [parsed.detail, parsed.message, parsed.error, ...errors].filter(Boolean).map(String).join(" | ") || raw;
  } catch { return raw; }
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
    const actuals = included.reduce((total, run) => total + manualActualCount(run), 0);
    return { total: runs.length, included: included.length, held: held.length, red: red.length, amber: amber.length, stops, actuals };
  }, [payload]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setError(undefined); setSummary(undefined); setPayload(undefined);
    const file = event.target.files?.[0]; if (!file) return; setFileName(file.name);
    try {
      const parsed = JSON.parse(await file.text()) as PlannerPlanPayload;
      if (!parsed?.planningDate || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.planningDate)) throw new Error("The planner file needs a valid planningDate (YYYY-MM-DD). It will display as DD/MM/YYYY after upload.");
      if (!Array.isArray(parsed.runs) || parsed.runs.length === 0) throw new Error("The planner file contains no runs.");
      const refs = parsed.runs.map((run) => String(run.runRef || "").trim().toUpperCase());
      if (refs.some((ref) => !ref)) throw new Error("Every planner run must have a runRef.");
      const duplicate = refs.find((ref, index) => refs.indexOf(ref) !== index); if (duplicate) throw new Error(`Duplicate run reference in file: ${duplicate}.`);
      if (parsed.runs.some((run) => run.planningDate && run.planningDate !== parsed.planningDate)) throw new Error("One or more runs use a different planning date from the file header.");
      setPayload(parsed);
    } catch (exception) { setError(exception instanceof Error ? exception.message : "The planner file could not be read."); }
  }

  async function importPlan() {
    if (!payload || busy) return;
    if (!window.confirm(`Import planner plan for ${formatDate(payload.planningDate)}?\n\n${preview.included} runs will be submitted. ${preview.held} held/excluded runs will remain excluded.`)) return;
    setBusy(true); setError(undefined); setSummary(undefined);
    try {
      const accessToken = await token();
      const response = await fetch("/tms-api/api/v1/planning/import-plan", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readError(response));
      setSummary(await response.json() as ImportSummary);
    } catch (exception) { setError(exception instanceof Error ? exception.message : "The planner plan could not be imported."); }
    finally { setBusy(false); }
  }

  return <section><div className="page-heading"><div><p className="eyebrow">Planner control</p><h1>Import planner plan</h1><p>Load the reconciled planner JSON, review the control totals, then confirm the authenticated import into the TMS.</p></div></div>
    <div className="card" style={{ maxWidth: 1100, display: "grid", gap: 18 }}>
      <label style={{ display: "grid", gap: 8, maxWidth: 560 }}><strong>Planner JSON file</strong><input type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event)} disabled={busy} /></label>
      {fileName && <p><strong>Selected:</strong> {fileName}</p>}
      {payload && <><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><span className="badge"><strong>{formatDate(payload.planningDate)}</strong> planning date</span><span className="badge"><strong>{preview.total}</strong> source runs</span><span className="badge"><strong>{preview.included}</strong> to import</span><span className="badge"><strong>{preview.held}</strong> held / excluded</span><span className="badge"><strong>{preview.stops}</strong> source lines</span><span className="badge"><strong>{preview.actuals}</strong> manual actual/ETA lines</span><span className="badge"><strong>{preview.red}</strong> red</span><span className="badge"><strong>{preview.amber}</strong> amber</span></div>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Run</th><th>Type</th><th>Driver</th><th>Vehicle</th><th>Trailer</th><th>Source lines</th><th>First collect window</th><th>Deliver by</th><th>Manual actuals/ETAs</th><th>Capacity</th><th>Import</th><th>Reconciliation</th></tr></thead><tbody>{safeRuns(payload).map((run, index) => <tr key={`${run.runRef}-${index}`}><td><strong>{run.runRef || "—"}</strong></td><td>{run.runType || "—"}</td><td>{run.driver || "Unallocated"}</td><td>{run.vehicle || "—"}</td><td>{run.trailer || "—"}</td><td>{run.stops?.length || 0}</td><td>{firstCollect(run)}</td><td>{finalDeadline(run)}</td><td>{manualActualCount(run)}</td><td>{run.capacityStatus || "—"}{typeof run.mixedUtilisationPercent === "number" ? ` · ${run.mixedUtilisationPercent.toFixed(1)}%` : ""}</td><td>{run.includeInImport === false ? "Held" : "Yes"}</td><td>{run.reconciliationStatus || "—"}</td></tr>)}</tbody></table></div>
      <button className="primary" disabled={busy || preview.included === 0} onClick={() => void importPlan()}>{busy ? "Importing…" : `Confirm import of ${preview.included} runs`}</button></>}
      {error && <div className="notice inline-notice"><strong>Import failed</strong><div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{error}</div></div>}
      {summary && <div style={{ display: "grid", gap: 12 }}><h2>Import complete · {formatDate(summary.planningDate)}</h2><div>{summary.created} created · {summary.updated} updated · {summary.unchanged} unchanged · {summary.held} held</div>{summary.unresolvedDrivers.length > 0 && <div>Drivers: {summary.unresolvedDrivers.join(", ")}</div>}{summary.unresolvedVehicles.length > 0 && <div>Vehicles: {summary.unresolvedVehicles.join(", ")}</div>}{summary.unresolvedTrailers.length > 0 && <div>Trailers: {summary.unresolvedTrailers.join(", ")}</div>}{summary.warnings.length > 0 && <ul>{summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div>}
    </div></section>;
}
