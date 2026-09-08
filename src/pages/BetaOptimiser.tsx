import { useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { formatDateLong, formatDateTime, todayIsoDate } from "../lib/dateUtils";
import { parsePlannerCsv } from "../lib/plannerCsvImport";
import {
  type BetaOptimiserDay,
  type BetaOptimiserRoute,
  type BetaPlannerComparison,
  plannerPayloadToBetaComparison,
} from "../lib/betaOptimiser";

function miles(value?: number) { return value == null ? "—" : `${value.toFixed(1)} mi`; }
function minutes(value?: number) {
  if (value == null) return "—";
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}

function Saving({ milesSaved, minutesSaved }: { milesSaved?: number; minutesSaved?: number }) {
  if (!milesSaved && !minutesSaved) return <span>Current order retained</span>;
  return <strong>{milesSaved ? `${milesSaved.toFixed(1)} mi` : "0 mi"} / {minutesSaved ? minutes(minutesSaved) : "0m"} saving</strong>;
}

function RouteSequence({ title, stops }: { title: string; stops: Array<{ sequence?: number; name: string }> }) {
  return <div className="panel" style={{ padding: 10, minWidth: 0 }}>
    <small>{title}</small>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
      {stops.map((stop, index) => <span key={`${title}-${index}-${stop.name}`} style={{ border: "1px solid #c8d7df", borderRadius: 999, padding: "4px 8px", background: "#fff" }}>{stop.sequence ?? index + 1}. {stop.name}</span>)}
    </div>
  </div>;
}

function RouteCard({ route }: { route: BetaOptimiserRoute }) {
  const [open, setOpen] = useState(false);
  const improved = (route.savingMiles ?? 0) > 0 || (route.savingDriveMinutes ?? 0) > 0;
  return <article className="panel" style={{ borderLeft: `5px solid ${!route.routingAvailable ? "#9a6700" : improved ? "#2f6f44" : "#6b7c86"}`, padding: 12 }}>
    <button type="button" onClick={() => setOpen(value => !value)} style={{ width: "100%", padding: 0, border: 0, background: "transparent", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div>
          <strong>{route.reference}</strong> <small>· {route.status}{route.isProtected ? " · protected" : ""}</small>
          <div><small>{route.driver || "Driver unallocated"} · {route.vehicle || "Vehicle unallocated"} · {route.trailer || "Trailer unallocated"}</small></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div>{route.routingAvailable ? <Saving milesSaved={route.savingMiles} minutesSaved={route.savingDriveMinutes} /> : <strong>Routing evidence unavailable</strong>}</div>
          <small>{open ? "Hide breakdown" : "Show breakdown"}</small>
        </div>
      </div>
    </button>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 10 }}>
      <div><small>Current HGV route</small><div><strong>{miles(route.currentMiles)} · {minutes(route.currentDriveMinutes)}</strong></div></div>
      <div><small>Suggested HGV route</small><div><strong>{route.proposedMiles != null ? `${miles(route.proposedMiles)} · ${minutes(route.proposedDriveMinutes)}` : "No proven change"}</strong></div></div>
      <div><small>Tacho availability</small><div><strong>{route.tachoDriveAvailableMinutes != null ? minutes(route.tachoDriveAvailableMinutes) : "Not verified"}</strong></div></div>
      <div><small>Fleetio</small><div><strong>{route.fleetioStatus || "No status"}</strong></div></div>
    </div>
    {open && <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
      <p style={{ margin: 0 }}>{route.rationale}</p>
      {route.lastTachoSyncUtc && <small>Tacho evidence last synchronised {formatDateTime(route.lastTachoSyncUtc)}.</small>}
      <RouteSequence title="Current stop order" stops={route.before} />
      {route.proposedMiles != null && <RouteSequence title="Beta suggested order" stops={route.after} />}
      {route.warnings.map((warning, index) => <p className="notice inline-notice" key={`${route.loadId}-warning-${index}`}>{warning}</p>)}
    </div>}
  </article>;
}

export function BetaOptimiser() {
  const token = useAccessToken();
  const [planningDate, setPlanningDate] = useState(todayIsoDate());
  const [analysis, setAnalysis] = useState<BetaOptimiserDay>();
  const [plannerComparison, setPlannerComparison] = useState<BetaPlannerComparison>();
  const [plannerFileName, setPlannerFileName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const orderedRoutes = useMemo(() => [...(analysis?.routes || [])].sort((a, b) => (b.savingMiles || 0) - (a.savingMiles || 0) || a.reference.localeCompare(b.reference, undefined, { numeric: true })), [analysis]);

  async function analyseDay(date = planningDate) {
    setBusy(true); setMessage(undefined);
    try {
      const result = await request<BetaOptimiserDay>(`/api/v1/beta-optimiser/day?planningDate=${encodeURIComponent(date)}`, await token(), undefined, 180000);
      setAnalysis(result);
      setMessage(`Read-only Beta analysis completed for ${formatDateLong(date)}. No Planner or Dispatch data was changed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Beta Optimiser could not analyse the day.");
    } finally { setBusy(false); }
  }

  async function uploadPlannerCsv(file?: File) {
    if (!file) return;
    setBusy(true); setMessage(undefined); setPlannerComparison(undefined);
    try {
      const text = await file.text();
      const payload = parsePlannerCsv(text, file.name);
      const comparisonRequest = plannerPayloadToBetaComparison(payload);
      setPlannerFileName(file.name);
      setPlanningDate(payload.planningDate);
      const access = await token();
      const [day, comparison] = await Promise.all([
        request<BetaOptimiserDay>(`/api/v1/beta-optimiser/day?planningDate=${encodeURIComponent(payload.planningDate)}`, access, undefined, 180000),
        request<BetaPlannerComparison>("/api/v1/beta-optimiser/planner-csv/compare", access, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(comparisonRequest),
        }, 180000),
      ]);
      setAnalysis(day);
      setPlannerComparison(comparison);
      setMessage(`${file.name} benchmarked against the live TMS day using Azure Maps HGV routing. No planning data was imported or changed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Planner CSV could not be analysed.");
    } finally { setBusy(false); }
  }

  const benchmarkDelta = analysis && plannerComparison ? plannerComparison.currentMiles - analysis.projectedMiles : undefined;

  return <section style={{ display: "grid", gap: 14 }}>
    <div className="panel" style={{ padding: 16, borderTop: "5px solid #2f6f44" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 3 }}>Planning lab · read-only</p>
          <h1 style={{ margin: 0 }}>Beta Optimiser</h1>
          <p style={{ marginBottom: 0, maxWidth: 850 }}>Whole-day route analysis using Azure Maps HGV/truck routing. Beta can recommend and explain improvements, but it cannot alter Planner or Dispatch yet.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label><small>Planning date</small><br/><input type="date" value={planningDate} onChange={event => setPlanningDate(event.target.value)} disabled={busy} /></label>
          <button className="primary" type="button" onClick={() => void analyseDay()} disabled={busy || !planningDate}>{busy ? "Analysing…" : "Optimise day (Beta)"}</button>
          <label style={{ display: "inline-flex", alignItems: "center", cursor: busy ? "default" : "pointer" }}><span className="button">Upload planner CSV</span><input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={event => void uploadPlannerCsv(event.target.files?.[0])}/></label>
        </div>
      </div>
      <p className="notice inline-notice" style={{ marginTop: 12 }}><strong>Routing rule:</strong> only live Azure Maps HGV evidence can support a mileage/time recommendation. Haversine or crow-fly estimates are never used to claim an optimisation saving.</p>
      {message && <p className="notice inline-notice">{message}</p>}
    </div>

    {analysis && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8 }}>
        <div className="panel"><small>Runs analysed</small><div><strong>{analysis.routedRunCount}/{analysis.runCount}</strong></div></div>
        <div className="panel"><small>Current HGV mileage</small><div><strong>{miles(analysis.currentMiles)}</strong></div></div>
        <div className="panel"><small>Beta projected mileage</small><div><strong>{miles(analysis.projectedMiles)}</strong></div></div>
        <div className="panel"><small>Potential mileage saving</small><div><strong>{miles(analysis.savingMiles)}</strong></div></div>
        <div className="panel"><small>Potential drive-time saving</small><div><strong>{minutes(analysis.savingDriveMinutes)}</strong></div></div>
        <div className="panel"><small>Routing coverage</small><div><strong>{analysis.unroutedRunCount === 0 ? "Complete" : `${analysis.unroutedRunCount} unavailable`}</strong></div></div>
      </div>
      {analysis.warnings.map((warning, index) => <p className="notice inline-notice" key={`day-warning-${index}`}>{warning}</p>)}
      <div style={{ display: "grid", gap: 8 }}>
        {orderedRoutes.map(route => <RouteCard route={route} key={route.loadId} />)}
      </div>
    </>}

    {plannerComparison && <div className="panel" style={{ padding: 16 }}>
      <p className="eyebrow" style={{ marginBottom: 3 }}>Planner benchmark</p>
      <h2 style={{ marginTop: 0 }}>{plannerFileName || "Uploaded planner CSV"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8 }}>
        <div className="panel"><small>Planner routes routed</small><div><strong>{plannerComparison.routedRouteCount}/{plannerComparison.routeCount}</strong></div></div>
        <div className="panel"><small>Planner CSV HGV mileage</small><div><strong>{miles(plannerComparison.currentMiles)}</strong></div></div>
        <div className="panel"><small>Planner CSV after Beta resequence</small><div><strong>{miles(plannerComparison.projectedMiles)}</strong></div></div>
        <div className="panel"><small>CSV internal saving</small><div><strong>{miles(plannerComparison.savingMiles)} · {minutes(plannerComparison.savingDriveMinutes)}</strong></div></div>
        <div className="panel"><small>Planner vs Beta day</small><div><strong>{benchmarkDelta == null ? "—" : benchmarkDelta > 0 ? `${benchmarkDelta.toFixed(1)} mi above Beta` : `${Math.abs(benchmarkDelta).toFixed(1)} mi below Beta`}</strong></div></div>
      </div>
      {plannerComparison.warnings.map((warning, index) => <p className="notice inline-notice" key={`planner-warning-${index}`}>{warning}</p>)}
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {plannerComparison.routes.map(route => <article className="panel" key={route.reference} style={{ padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><strong>{route.reference}</strong><span>{route.routingAvailable ? <Saving milesSaved={route.savingMiles} minutesSaved={route.savingDriveMinutes} /> : "Routing unavailable"}</span></div>
          <small>{route.rationale}</small>
          {route.routingAvailable && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 8, marginTop: 8 }}><RouteSequence title="Planner CSV order" stops={route.before.map((name, index) => ({ sequence: index + 1, name }))}/>{route.proposedMiles != null && <RouteSequence title="Beta suggestion" stops={route.after.map((name, index) => ({ sequence: index + 1, name }))}/>}</div>}
          {route.warnings.map((warning, index) => <p className="notice inline-notice" key={`${route.reference}-warning-${index}`}>{warning}</p>)}
        </article>)}
      </div>
    </div>}
  </section>;
}
