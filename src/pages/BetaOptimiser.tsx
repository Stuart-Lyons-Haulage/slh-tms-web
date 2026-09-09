import { useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { formatDateLong, formatDateTime, todayIsoDate } from "../lib/dateUtils";
import { parsePlannerCsv } from "../lib/plannerCsvImport";
import {
  type BetaDayPlan,
  type BetaDayPlanComparison,
  type BetaDayPlanRun,
  type BetaLyonsPlanRoute,
  plannerPayloadToBetaComparison,
} from "../lib/betaOptimiser";

function miles(value?: number) { return value == null ? "—" : `${value.toFixed(1)} mi`; }
function minutes(value?: number) {
  if (value == null) return "—";
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="panel" style={{ padding: 12 }}>
    <small>{label}</small>
    <div><strong>{value}</strong></div>
    {note && <small>{note}</small>}
  </div>;
}

function StopSequence({ title, stops }: { title: string; stops: Array<{ sequence?: number; name: string }> }) {
  return <div className="panel" style={{ padding: 10, minWidth: 0 }}>
    <small>{title}</small>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
      {stops.map((stop, index) => <span key={`${title}-${index}-${stop.name}`} style={{ border: "1px solid #c8d7df", borderRadius: 999, padding: "4px 8px", background: "#fff" }}>{stop.sequence ?? index + 1}. {stop.name}</span>)}
    </div>
  </div>;
}

function BetaRunCard({ run }: { run: BetaDayPlanRun }) {
  const [open, setOpen] = useState(false);
  return <article className="panel" style={{ padding: 12, borderLeft: `5px solid ${run.routingAvailable ? "#2f6f44" : "#9a6700"}` }}>
    <button type="button" onClick={() => setOpen(value => !value)} style={{ width: "100%", padding: 0, border: 0, background: "transparent", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div>
          <strong>{run.reference}</strong> <small>· {run.period} · {run.palletFamily}</small>
          <div><small>{run.orders.length} order line{run.orders.length === 1 ? "" : "s"} · {run.plannedPallets}/{run.capacityPallets} pallets · {run.utilisationPercent.toFixed(0)}% utilised</small></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <strong>{run.routingAvailable ? `${miles(run.miles)} · ${minutes(run.driveMinutes)}` : "HGV routing unavailable"}</strong>
          <div><small>{open ? "Hide detail" : "Show orders & route"}</small></div>
        </div>
      </div>
    </button>
    {open && <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      <StopSequence title="Beta HGV stop order" stops={run.stops} />
      <div className="panel" style={{ padding: 10 }}>
        <small>Orders carried on this run</small>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          {run.orders.map((order, index) => <div key={`${run.reference}-${order.sourceLineId}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(110px,0.7fr) minmax(180px,2fr) auto", gap: 10, alignItems: "baseline" }}>
            <strong>{order.reference}</strong>
            <span>{order.collectionName} → {order.deliveryName}</span>
            <span>{order.pallets} plt</span>
          </div>)}
        </div>
      </div>
      {run.warnings.map((warning, index) => <p className="notice inline-notice" key={`${run.reference}-warning-${index}`}>{warning}</p>)}
    </div>}
  </article>;
}

function LyonsRouteCard({ route }: { route: BetaLyonsPlanRoute }) {
  const [open, setOpen] = useState(false);
  return <article className="panel" style={{ padding: 10, borderLeft: `4px solid ${route.routingAvailable ? "#6b7c86" : "#9a6700"}` }}>
    <button type="button" onClick={() => setOpen(value => !value)} style={{ width: "100%", padding: 0, border: 0, background: "transparent", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div><strong>{route.reference}</strong><div><small>{route.orderLineCount} order lines · {route.plannedPallets} pallets · {route.stopCount} stops</small></div></div>
        <div style={{ textAlign: "right" }}><strong>{route.routingAvailable ? `${miles(route.miles)} · ${minutes(route.driveMinutes)}` : "HGV routing unavailable"}</strong><div><small>{open ? "Hide route" : "Show route"}</small></div></div>
      </div>
    </button>
    {open && <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      <StopSequence title="Lyons plan stop order" stops={route.stops.map((name, index) => ({ sequence: index + 1, name }))} />
      {route.warnings.map((warning, index) => <p className="notice inline-notice" key={`${route.reference}-warning-${index}`}>{warning}</p>)}
    </div>}
  </article>;
}

function ComparisonPanel({ comparison, fileName }: { comparison: BetaDayPlanComparison; fileName?: string }) {
  const { beta, lyons, reconciliation } = comparison;
  const mileageHeadline = !reconciliation.comparableRouting || reconciliation.milesDelta == null
    ? "Withheld until coverage matches"
    : reconciliation.milesDelta > 0
      ? `Beta ${reconciliation.milesDelta.toFixed(1)} mi lower`
      : reconciliation.milesDelta < 0
        ? `Lyons ${Math.abs(reconciliation.milesDelta).toFixed(1)} mi lower`
        : "Same HGV mileage";
  const timeHeadline = !reconciliation.comparableRouting || reconciliation.driveMinutesDelta == null
    ? "—"
    : reconciliation.driveMinutesDelta > 0
      ? `Beta ${minutes(reconciliation.driveMinutesDelta)} quicker`
      : reconciliation.driveMinutesDelta < 0
        ? `Lyons ${minutes(Math.abs(reconciliation.driveMinutesDelta))} quicker`
        : "Same drive time";
  const runHeadline = reconciliation.runCountDelta > 0
    ? `Beta uses ${reconciliation.runCountDelta} fewer`
    : reconciliation.runCountDelta < 0
      ? `Lyons uses ${Math.abs(reconciliation.runCountDelta)} fewer`
      : "Same run count";

  return <div className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
    <div>
      <p className="eyebrow" style={{ marginBottom: 3 }}>Like-for-like day comparison</p>
      <h2 style={{ margin: 0 }}>{fileName || "Uploaded Lyons Collections Plan"}</h2>
      <p style={{ marginBottom: 0 }}>Beta rebuilds its own day from the TMS orders, then routes both plans independently using the same live Azure Maps HGV evidence.</p>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 8 }}>
      <Metric label="Orders matched" value={`${reconciliation.matchedOrderLines}/${reconciliation.betaOrderLines}`} note={reconciliation.orderCoverageComplete ? "Exact work coverage" : "Review differences below"} />
      <Metric label="Runs" value={`${beta.runCount} Beta / ${lyons.routeCount} Lyons`} note={runHeadline} />
      <Metric label="Pallets" value={`${beta.totalPallets} Beta / ${lyons.totalPallets} Lyons`} />
      <Metric label="Beta HGV mileage" value={miles(beta.totalMiles)} note={beta.routingComplete ? "Complete route coverage" : "Partial routed total"} />
      <Metric label="Lyons HGV mileage" value={miles(lyons.totalMiles)} note={lyons.routingComplete ? "Complete route coverage" : "Partial routed total"} />
      <Metric label="Mileage result" value={mileageHeadline} note={timeHeadline} />
    </div>

    {!reconciliation.orderCoverageComplete && <div className="notice inline-notice"><strong>No misleading mileage comparison:</strong> the route delta is withheld until Beta and the Lyons sheet contain the same order work.</div>}
    {reconciliation.warnings.map((warning, index) => <p className="notice inline-notice" key={`reconciliation-warning-${index}`}>{warning}</p>)}

    {(reconciliation.missingFromLyons.length > 0 || reconciliation.onlyInLyons.length > 0) && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 10 }}>
      <div className="panel" style={{ padding: 10 }}>
        <strong>In TMS/Beta but missing from Lyons plan</strong>
        {reconciliation.missingFromLyons.length === 0 ? <p><small>None</small></p> : <ul>{reconciliation.missingFromLyons.map(item => <li key={item}>{item}</li>)}</ul>}
      </div>
      <div className="panel" style={{ padding: 10 }}>
        <strong>In Lyons plan but not in Beta input</strong>
        {reconciliation.onlyInLyons.length === 0 ? <p><small>None</small></p> : <ul>{reconciliation.onlyInLyons.map(item => <li key={item}>{item}</li>)}</ul>}
      </div>
    </div>}

    {lyons.warnings.map((warning, index) => <p className="notice inline-notice" key={`lyons-warning-${index}`}>{warning}</p>)}
    <div style={{ display: "grid", gap: 8 }}>
      <h3 style={{ marginBottom: 0 }}>Lyons Collections Plan · HGV route evidence</h3>
      {lyons.routes.map(route => <LyonsRouteCard key={route.reference} route={route} />)}
    </div>
  </div>;
}

export function BetaOptimiser() {
  const token = useAccessToken();
  const [planningDate, setPlanningDate] = useState(todayIsoDate());
  const [dayPlan, setDayPlan] = useState<BetaDayPlan>();
  const [comparison, setComparison] = useState<BetaDayPlanComparison>();
  const [plannerFileName, setPlannerFileName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function buildDay(date = planningDate) {
    setBusy(true);
    setMessage(undefined);
    setComparison(undefined);
    try {
      const result = await request<BetaDayPlan>(`/api/v1/beta-optimiser/day-plan?planningDate=${encodeURIComponent(date)}`, await token(), undefined, 180000);
      setDayPlan(result);
      setMessage(`Beta independently built ${result.runCount} run${result.runCount === 1 ? "" : "s"} from ${result.eligibleOrderLines} eligible order line${result.eligibleOrderLines === 1 ? "" : "s"} for ${formatDateLong(date)}. No Planner or Dispatch data was changed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Beta could not build the day from current orders.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLyonsPlan(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const text = await file.text();
      const payload = parsePlannerCsv(text, file.name);
      const comparisonRequest = plannerPayloadToBetaComparison(payload);
      if (comparisonRequest.routes.length === 0) throw new Error("The Lyons plan contains no runs marked for inclusion.");
      setPlannerFileName(file.name);
      setPlanningDate(payload.planningDate);
      const result = await request<BetaDayPlanComparison>("/api/v1/beta-optimiser/day-plan/compare", await token(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(comparisonRequest),
      }, 180000);
      setDayPlan(result.beta);
      setComparison(result);
      setMessage(`${file.name} compared with a fresh Beta build for ${formatDateLong(payload.planningDate)}. ${result.reconciliation.matchedOrderLines}/${result.reconciliation.betaOrderLines} Beta order lines matched the uploaded plan. Nothing was imported or changed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Lyons Collections Plan could not be compared.");
    } finally {
      setBusy(false);
    }
  }

  return <section style={{ display: "grid", gap: 14 }}>
    <div className="panel" style={{ padding: 16, borderTop: "5px solid #2f6f44" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 3 }}>Planning lab · read-only</p>
          <h1 style={{ margin: 0 }}>Beta Optimiser</h1>
          <p style={{ marginBottom: 0, maxWidth: 900 }}>Build a complete day independently from the TMS orders, then upload the Lyons Collections Plan to compare the human plan with Beta on exactly the same work.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label><small>Planning date</small><br/><input type="date" value={planningDate} onChange={event => setPlanningDate(event.target.value)} disabled={busy} /></label>
          <button className="primary" type="button" onClick={() => void buildDay()} disabled={busy || !planningDate}>{busy ? "Working…" : "Build day from orders"}</button>
          <label style={{ display: "inline-flex", alignItems: "center", cursor: busy ? "default" : "pointer" }}><span className="button">Upload Lyons plan CSV</span><input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={event => { void uploadLyonsPlan(event.target.files?.[0]); event.target.value = ""; }}/></label>
        </div>
      </div>
      <p className="notice inline-notice" style={{ marginTop: 12 }}><strong>Routing rule:</strong> Beta and the uploaded Lyons plan are both measured using live Azure Maps HGV/truck routes. Haversine/crow-fly estimates are never substituted to claim a saving.</p>
      <p className="notice inline-notice"><strong>Operating rule:</strong> Beta keeps AM/PM work separate, respects pallet capacity, and completes the run's collections before beginning deliveries. Unmapped work stays visible as an exception.</p>
      {message && <p className="notice inline-notice">{message}</p>}
    </div>

    {dayPlan && <>
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <div><p className="eyebrow" style={{ marginBottom: 3 }}>Beta-built day</p><h2 style={{ margin: 0 }}>{formatDateLong(dayPlan.planningDate)}</h2></div>
          <small>Generated {formatDateTime(dayPlan.generatedAtUtc)}</small>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8, marginTop: 12 }}>
          <Metric label="Eligible order lines" value={String(dayPlan.eligibleOrderLines)} note={`${dayPlan.plannedOrderLines} represented in runs`} />
          <Metric label="Beta runs" value={String(dayPlan.runCount)} note={`${dayPlan.routedRunCount} with live HGV evidence`} />
          <Metric label="Pallets" value={String(dayPlan.totalPallets)} />
          <Metric label={dayPlan.routingComplete ? "Total HGV mileage" : "Routed HGV mileage"} value={miles(dayPlan.totalMiles)} note={dayPlan.routingComplete ? "Complete" : "Partial — see warnings"} />
          <Metric label={dayPlan.routingComplete ? "Total drive time" : "Routed drive time"} value={minutes(dayPlan.totalDriveMinutes)} />
          <Metric label="Site mapping" value={dayPlan.unmappedOrderLines === 0 ? "Complete" : `${dayPlan.unmappedOrderLines} need mapping`} />
        </div>
      </div>
      {dayPlan.warnings.map((warning, index) => <p className="notice inline-notice" key={`beta-day-warning-${index}`}>{warning}</p>)}
      <div style={{ display: "grid", gap: 8 }}>
        {dayPlan.runs.map(run => <BetaRunCard key={run.reference} run={run} />)}
      </div>
    </>}

    {comparison && <ComparisonPanel comparison={comparison} fileName={plannerFileName} />}
  </section>;
}
