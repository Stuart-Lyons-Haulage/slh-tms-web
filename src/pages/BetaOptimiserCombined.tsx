import { useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { formatDateLong, todayIsoDate } from "../lib/dateUtils";
import { parsePlannerPlanFiles } from "../lib/plannerFileImport";
import {
  plannerPayloadToBetaComparison,
  type BetaDayPlan,
  type BetaDayPlanComparison,
  type BetaDayPlanRun,
} from "../lib/betaOptimiser";

function qty(value?: number) { return value && value > 0 ? `${value} pallets` : "quantity not stated"; }
function miles(value?: number) { return value == null ? "—" : `${value.toFixed(1)} mi`; }

function RunCard({ run }: { run: BetaDayPlanRun }) {
  return <article className="panel" style={{ padding: 10 }}>
    <strong>{run.reference}</strong> <small>· {run.period}</small>
    <div><small>{run.orders.length} order line{run.orders.length === 1 ? "" : "s"} · {run.plannedPallets > 0 ? `${run.plannedPallets} pallets` : "quantity not stated"} · {run.routingAvailable ? miles(run.miles) : "HGV routing unavailable"}</small></div>
  </article>;
}

export function BetaOptimiserCombined() {
  const token = useAccessToken();
  const [planningDate, setPlanningDate] = useState(todayIsoDate());
  const [dayPlan, setDayPlan] = useState<BetaDayPlan>();
  const [comparison, setComparison] = useState<BetaDayPlanComparison>();
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [warnings, setWarnings] = useState<string[]>([]);

  async function buildDay() {
    setBusy(true); setMessage(undefined); setWarnings([]); setComparison(undefined);
    try {
      const result = await request<BetaDayPlan>(`/api/v1/beta-optimiser/day-plan?planningDate=${encodeURIComponent(planningDate)}`, await token(), undefined, 90000);
      setDayPlan(result);
      setMessage(`Beta independently built ${result.runCount} runs from ${result.eligibleOrderLines} order lines for ${formatDateLong(planningDate)}. Planner and Dispatch were not changed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Beta could not build the day.");
    } finally { setBusy(false); }
  }

  async function compareFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true); setMessage(undefined); setWarnings([]);
    try {
      const payload = await parsePlannerPlanFiles(files);
      const comparisonRequest = plannerPayloadToBetaComparison(payload);
      if (!comparisonRequest.routes.length) throw new Error("The selected planning workbooks contain no included movements.");
      setPlanningDate(payload.planningDate);
      setFileNames(files.map(file => file.name));
      setWarnings(payload.exceptions.map(item => [item.code, item.detail].filter(Boolean).join(": ")).filter(Boolean));
      const result = await request<BetaDayPlanComparison>("/api/v1/beta-optimiser/day-plan/compare", await token(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(comparisonRequest),
      }, 90000);
      setDayPlan(result.beta);
      setComparison(result);
      setMessage(`${files.length} workbook${files.length === 1 ? "" : "s"} read successfully. ${result.reconciliation.matchedOrderLines}/${result.reconciliation.betaOrderLines} Beta order lines matched. Nothing was imported into Planner or Dispatch.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The planning workbooks could not be compared.");
    } finally { setBusy(false); }
  }

  const reconciliation = comparison?.reconciliation;

  return <section style={{ display: "grid", gap: 14 }}>
    <div className="panel" style={{ padding: 16, borderTop: "5px solid #2f6f44" }}>
      <p className="eyebrow" style={{ marginBottom: 3 }}>Planning lab · read-only</p>
      <h1 style={{ margin: 0 }}>Beta Optimiser</h1>
      <p>Build the full day from TMS orders, then compare it with both Lyons Collections and Southbound work. Wave 3, markets, trays, crates, trollies and transfers are retained even where no pallet count is stated.</p>

      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <label><small>Planning date</small><br/><input type="date" value={planningDate} onChange={event => setPlanningDate(event.target.value)} disabled={busy}/></label>
        <button className="primary" type="button" onClick={() => void buildDay()} disabled={busy}>{busy ? "Working…" : "Build day from orders"}</button>
        <label><small>Upload planning files</small><br/><input type="file" multiple accept=".csv,.xlsx,.xls,.xlsm" disabled={busy} onChange={event => { const files = Array.from(event.target.files ?? []); void compareFiles(files); event.target.value = ""; }}/></label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 10, marginTop: 12 }}>
        <p className="notice inline-notice"><strong>Upload together:</strong> select the Lyons Collections workbook and the Southbound workbook in the same file chooser. Both must be for the same planning date.</p>
        <p className="notice inline-notice"><strong>Wave 3:</strong> the Southbound `WAVE 3` sheet is treated as overnight Waitrose work. Current market sheets are only used when dated for the plan day; stale market tabs are ignored.</p>
        <p className="notice inline-notice"><strong>No invented capacity:</strong> missing pallet counts remain “quantity not stated”. Those movements remain in route/reconciliation evidence but are excluded from pallet-capacity utilisation.</p>
        <p className="notice inline-notice"><strong>Workbook rules:</strong> Lyons Collections reads only `Collection Plan`. Southbound uses its dedicated `Southbound`, `WAVE 3`, transfers/outbound and current market evidence — it is never parsed as a Collection Plan.</p>
      </div>

      {fileNames.length > 0 && <p><small><strong>Selected:</strong> {fileNames.join(" + ")}</small></p>}
      {message && <p className="notice inline-notice">{message}</p>}
      {warnings.map((warning, index) => <p className="notice inline-notice" key={`${warning}-${index}`}>{warning}</p>)}
    </div>

    {comparison && <div className="panel" style={{ padding: 16, display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Like-for-like comparison</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>
        <div className="panel" style={{ padding: 10 }}><small>Movement match</small><div><strong>{reconciliation?.matchedOrderLines}/{reconciliation?.betaOrderLines}</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Runs</small><div><strong>{comparison.beta.runCount} Beta / {comparison.lyons.routeCount} human</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Known pallets</small><div><strong>{comparison.beta.totalPallets} Beta / {comparison.lyons.totalPallets} human</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Beta HGV mileage</small><div><strong>{miles(comparison.beta.totalMiles)}</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Human HGV mileage</small><div><strong>{miles(comparison.lyons.totalMiles)}</strong></div></div>
      </div>
      {!reconciliation?.comparableRouting && <p className="notice inline-notice"><strong>Mileage comparison withheld:</strong> exact work coverage and complete live HGV routing are required before Beta claims a saving.</p>}
      {reconciliation?.warnings.map((warning, index) => <p className="notice inline-notice" key={`${warning}-${index}`}>{warning}</p>)}
      <h3>Human plan routes</h3>
      {comparison.lyons.routes.map(route => <article className="panel" key={route.reference} style={{ padding: 10 }}>
        <strong>{route.reference}</strong>
        <div><small>{route.orderLineCount} movement line{route.orderLineCount === 1 ? "" : "s"} · {qty(route.plannedPallets)} · {route.routingAvailable ? miles(route.miles) : "HGV routing unavailable"}</small></div>
        <div><small>{route.stops.join(" → ")}</small></div>
      </article>)}
    </div>}

    {dayPlan && <div className="panel" style={{ padding: 16, display: "grid", gap: 8 }}>
      <h2 style={{ margin: 0 }}>Beta-built day · {formatDateLong(dayPlan.planningDate)}</h2>
      <p><small>{dayPlan.plannedOrderLines} planned order lines · {dayPlan.runCount} runs · {dayPlan.routingComplete ? "complete HGV routing" : "partial HGV routing"}</small></p>
      {dayPlan.warnings.map((warning, index) => <p className="notice inline-notice" key={`${warning}-${index}`}>{warning}</p>)}
      {dayPlan.runs.map(run => <RunCard key={run.reference} run={run}/>)}
    </div>}
  </section>;
}
