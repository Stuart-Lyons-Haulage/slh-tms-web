import { useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { formatDateLong, formatDateTime, todayIsoDate } from "../lib/dateUtils";
import { parsePlannerPlanFiles } from "../lib/plannerFileImport";
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
function quantityLabel(pallets: number, capacity?: number) {
  if (capacity === 0 || pallets <= 0) return "quantity not stated";
  return `${pallets} pallets`;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="panel" style={{ padding: 12 }}><small>{label}</small><div><strong>{value}</strong></div>{note && <small>{note}</small>}</div>;
}

function StopSequence({ title, stops }: { title: string; stops: Array<{ sequence?: number; name: string }> }) {
  return <div className="panel" style={{ padding: 10 }}><small>{title}</small><div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{stops.map((stop, index) => <span key={`${title}-${index}-${stop.name}`} style={{ border: "1px solid #c8d7df", borderRadius: 999, padding: "4px 8px", background: "#fff" }}>{stop.sequence ?? index + 1}. {stop.name}</span>)}</div></div>;
}

function BetaRunCard({ run }: { run: BetaDayPlanRun }) {
  const [open, setOpen] = useState(false);
  const unquantified = run.capacityPallets === 0 || run.palletFamily.toLowerCase().includes("unquant");
  return <article className="panel" style={{ padding: 12, borderLeft: `5px solid ${run.routingAvailable ? "#2f6f44" : "#9a6700"}` }}>
    <button type="button" onClick={() => setOpen(value => !value)} style={{ width: "100%", border: 0, padding: 0, background: "transparent", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><strong>{run.reference}</strong> <small>· {run.period} · {run.palletFamily}</small><div><small>{run.orders.length} movement{run.orders.length === 1 ? "" : "s"} · {unquantified ? "quantity not stated" : `${run.plannedPallets}/${run.capacityPallets} pallets · ${run.utilisationPercent.toFixed(0)}% utilised`}</small></div></div>
        <div style={{ textAlign: "right" }}><strong>{run.routingAvailable ? `${miles(run.miles)} · ${minutes(run.driveMinutes)}` : "HGV routing unavailable"}</strong><div><small>{open ? "Hide detail" : "Show route"}</small></div></div>
      </div>
    </button>
    {open && <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      <StopSequence title="Beta HGV stop order" stops={run.stops} />
      <div className="panel" style={{ padding: 10 }}><small>Work carried on this run</small><div style={{ display: "grid", gap: 6, marginTop: 6 }}>{run.orders.map((order, index) => <div key={`${run.reference}-${order.sourceLineId}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(110px,.7fr) minmax(180px,2fr) auto", gap: 10 }}><strong>{order.reference}</strong><span>{order.collectionName} → {order.deliveryName}</span><span>{order.pallets > 0 ? `${order.pallets} plt` : "qty not stated"}</span></div>)}</div></div>
      {run.warnings.map((warning, index) => <p className="notice inline-notice" key={`${run.reference}-warning-${index}`}>{warning}</p>)}
    </div>}
  </article>;
}

function LyonsRouteCard({ route }: { route: BetaLyonsPlanRoute }) {
  const [open, setOpen] = useState(false);
  return <article className="panel" style={{ padding: 10, borderLeft: `4px solid ${route.routingAvailable ? "#6b7c86" : "#9a6700"}` }}>
    <button type="button" onClick={() => setOpen(value => !value)} style={{ width: "100%", border: 0, padding: 0, background: "transparent", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><div><strong>{route.reference}</strong><div><small>{route.orderLineCount} movement lines · {route.plannedPallets > 0 ? `${route.plannedPallets} pallets` : "quantity not stated"} · {route.stopCount} stops</small></div></div><div style={{ textAlign: "right" }}><strong>{route.routingAvailable ? `${miles(route.miles)} · ${minutes(route.driveMinutes)}` : "HGV routing unavailable"}</strong><div><small>{open ? "Hide route" : "Show route"}</small></div></div></div>
    </button>
    {open && <div style={{ display: "grid", gap: 8, marginTop: 10 }}><StopSequence title="Lyons physical stop order" stops={route.stops.map((name, index) => ({ sequence: index + 1, name }))} />{route.warnings.map((warning, index) => <p className="notice inline-notice" key={`${route.reference}-warning-${index}`}>{warning}</p>)}</div>}
  </article>;
}

export function BetaOptimiserCombined() {
  const token = useAccessToken();
  const [planningDate, setPlanningDate] = useState(todayIsoDate());
  const [dayPlan, setDayPlan] = useState<BetaDayPlan>();
  const [comparison, setComparison] = useState<BetaDayPlanComparison>();
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function buildDay(date = planningDate) {
    setBusy(true); setMessage(undefined); setComparison(undefined); setImportWarnings([]);
    try {
      const result = await request<BetaDayPlan>(`/api/v1/beta-optimiser/day-plan?planningDate=${encodeURIComponent(date)}`, await token(), undefined, 180000);
      setDayPlan(result);
      setMessage(`Beta independently built ${result.runCount} run${result.runCount === 1 ? "" : "s"} from ${result.eligibleOrderLines} eligible movement${result.eligibleOrderLines === 1 ? "" : "s"} for ${formatDateLong(date)}. Planner and Dispatch were not changed.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Beta could not build the day from current orders."); }
    finally { setBusy(false); }
  }

  async function uploadPlans(files: File[]) {
    if (!files.length) return;
    setBusy(true); setMessage(undefined);
    try {
      const payload = await parsePlannerPlanFiles(files);
      const comparisonRequest = plannerPayloadToBetaComparison(payload);
      if (!comparisonRequest.routes.length) throw new Error("The uploaded planning files contain no included routes.");
      setFileNames(files.map(file => file.name));
      setPlanningDate(payload.planningDate);
      setImportWarnings(payload.exceptions.map(exception => [exception.code, exception.detail].filter(Boolean).join(": ")));
      const result = await request<BetaDayPlanComparison>("/api/v1/beta-optimiser/day-plan/compare", await token(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(comparisonRequest) }, 180000);
      setDayPlan(result.beta); setComparison(result);
      setMessage(`${files.length} planning file${files.length === 1 ? "" : "s"} compared with a fresh Beta build for ${formatDateLong(payload.planningDate)}. ${result.reconciliation.matchedOrderLines}/${result.reconciliation.betaOrderLines} Beta movement lines matched. Nothing was imported or changed.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The planning files could not be compared."); }
    finally { setBusy(false); }
  }

  const reconciliation = comparison?.reconciliation;
  const mileageResult = !reconciliation?.comparableRouting || reconciliation.milesDelta == null ? "Withheld until coverage matches" : reconciliation.milesDelta > 0 ? `Beta ${reconciliation.milesDelta.toFixed(1)} mi lower` : reconciliation.milesDelta < 0 ? `Lyons ${Math.abs(reconciliation.milesDelta).toFixed(1)} mi lower` : "Same HGV mileage";

  return <section style={{ display: "grid", gap: 14 }}>
    <div className="panel" style={{ padding: 16, borderTop: "5px solid #2f6f44" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
        <div><p className="eyebrow" style={{ marginBottom: 3 }}>Planning lab · read-only</p><h1 style={{ margin: 0 }}>Beta Optimiser</h1><p style={{ marginBottom: 0, maxWidth: 950 }}>Build the full day from TMS orders, then compare it with both Lyons Collections and Southbound work. Wave 3, markets, trays, crates, trollies and transfers are retained even where no pallet count is stated.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label><small>Planning date</small><br/><input type="date" value={planningDate} onChange={event => setPlanningDate(event.target.value)} disabled={busy} /></label>
          <button className="primary" type="button" onClick={() => void buildDay()} disabled={busy || !planningDate}>{busy ? "Working…" : "Build day from orders"}</button>
          <label style={{ display: "inline-flex", alignItems: "center", cursor: busy ? "default" : "pointer" }}><span className="button">Upload planning files</span><input multiple type="file" accept=".csv,.xlsx,.xls,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" hidden disabled={busy} onChange={event => { void uploadPlans(Array.from(event.target.files || [])); event.target.value = ""; }}/></label>
        </div>
      </div>
      <p className="notice inline-notice" style={{ marginTop: 12 }}><strong>Upload together:</strong> select the Lyons Collections workbook and the Southbound workbook in the same file chooser. Both must be for the same planning date.</p>
      <p className="notice inline-notice"><strong>Wave 3:</strong> the Southbound `WAVE 3` sheet is treated as overnight Waitrose work. Current market sheets are read when dated for the plan day; stale market tabs are ignored and current Collection Board work remains visible for review.</p>
      <p className="notice inline-notice"><strong>No invented capacity:</strong> missing pallet counts remain “quantity not stated”. Those movements are routed/reconciled but excluded from pallet-capacity utilisation.</p>
      {message && <p className="notice inline-notice">{message}</p>}
      {importWarnings.map((warning, index) => <p className="notice inline-notice" key={`import-warning-${index}`}>{warning}</p>)}
    </div>

    {comparison && <div className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
      <div><p className="eyebrow" style={{ marginBottom: 3 }}>Combined human-plan comparison</p><h2 style={{ margin: 0 }}>{fileNames.join(" + ") || "Uploaded plans"}</h2></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 8 }}>
        <Metric label="Movements matched" value={`${comparison.reconciliation.matchedOrderLines}/${comparison.reconciliation.betaOrderLines}`} note={comparison.reconciliation.orderCoverageComplete ? "Exact work coverage" : "Review differences below"} />
        <Metric label="Runs" value={`${comparison.beta.runCount} Beta / ${comparison.lyons.routeCount} Lyons`} />
        <Metric label="Known pallets" value={`${comparison.beta.totalPallets} Beta / ${comparison.lyons.totalPallets} Lyons`} note="Unknown tray/crate/market quantities are not fabricated" />
        <Metric label="Beta HGV mileage" value={miles(comparison.beta.totalMiles)} />
        <Metric label="Lyons HGV mileage" value={miles(comparison.lyons.totalMiles)} />
        <Metric label="Mileage result" value={mileageResult} />
      </div>
      {!comparison.reconciliation.orderCoverageComplete && <p className="notice inline-notice"><strong>No misleading saving:</strong> mileage/time deltas remain withheld until the combined Collections + Southbound work matches TMS/Beta.</p>}
      {comparison.reconciliation.warnings.map((warning, index) => <p className="notice inline-notice" key={`rec-${index}`}>{warning}</p>)}
      {(comparison.reconciliation.missingFromLyons.length > 0 || comparison.reconciliation.onlyInLyons.length > 0) && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 10 }}><div className="panel" style={{ padding: 10 }}><strong>In TMS/Beta but missing from uploaded plans</strong><ul>{comparison.reconciliation.missingFromLyons.map(item => <li key={item}>{item}</li>)}</ul></div><div className="panel" style={{ padding: 10 }}><strong>In uploaded plans but not Beta input</strong><ul>{comparison.reconciliation.onlyInLyons.map(item => <li key={item}>{item}</li>)}</ul></div></div>}
      <div style={{ display: "grid", gap: 8 }}><h3 style={{ marginBottom: 0 }}>Uploaded plan · HGV route evidence</h3>{comparison.lyons.routes.map(route => <LyonsRouteCard key={route.reference} route={route} />)}</div>
    </div>}

    {dayPlan && <div className="panel" style={{ padding: 16, display: "grid", gap: 10 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><p className="eyebrow" style={{ marginBottom: 3 }}>Beta-built day</p><h2 style={{ margin: 0 }}>{formatDateLong(dayPlan.planningDate)}</h2></div><small>Generated {formatDateTime(dayPlan.generatedAtUtc)}</small></div>{dayPlan.warnings.map((warning, index) => <p className="notice inline-notice" key={`day-warning-${index}`}>{warning}</p>)}<div style={{ display: "grid", gap: 8 }}>{dayPlan.runs.map(run => <BetaRunCard key={run.reference} run={run} />)}</div></div>}
  </section>;
}
