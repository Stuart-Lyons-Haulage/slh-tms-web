import { useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { formatDateLong, todayIsoDate } from "../lib/dateUtils";
import { parsePlannerPlanFiles } from "../lib/plannerFileImport";
import {
  plannerPayloadToBetaComparison,
  type BetaDayPlan,
  type BetaDayPlanComparison,
  type BetaDayPlanRun,
  type BetaLyonsPlanRoute,
} from "../lib/betaOptimiser";

function qty(value?: number) { return value && value > 0 ? `${value} pallets` : "quantity not stated"; }
function miles(value?: number) { return value == null ? "—" : `${value.toFixed(1)} mi`; }
function pct(value?: number) { return value == null ? "—" : `${value.toFixed(1)}%`; }

type UtilisationView = {
  capacity?: number;
  utilisation?: number;
  family: string;
  status: string;
  note?: string;
};

function utilisationStatus(value?: number) {
  if (value == null) return "Quantity unknown";
  if (value > 100) return "Over capacity";
  if (value >= 95) return "Full / excellent";
  if (value >= 80) return "Good";
  if (value >= 65) return "Could improve";
  return "Under-utilised";
}

function humanUtilisation(route: BetaLyonsPlanRoute): UtilisationView {
  if (!route.plannedPallets || route.plannedPallets <= 0) {
    return { family: "Capacity unknown", status: "Quantity unknown", note: "No numeric pallet quantity was stated." };
  }
  const capacity = route.plannedPallets <= 26 ? 26 : 33;
  const utilisation = Math.round(route.plannedPallets / capacity * 1000) / 10;
  const family = route.plannedPallets <= 26 ? "Standard-capacity basis · 26" : "Euro-capacity basis · 33";
  const note = route.plannedPallets > 33
    ? "Planned total exceeds a 33-Euro-pallet trailer and needs planner review / split evidence."
    : route.plannedPallets > 26
      ? "Workbook does not explicitly confirm pallet family here; Euro capacity is used because the run exceeds 26."
      : "Workbook does not explicitly confirm pallet family here; Standard capacity is used for the visual benchmark.";
  return { capacity, utilisation, family, status: utilisationStatus(utilisation), note };
}

function betaUtilisation(run: BetaDayPlanRun): UtilisationView {
  if (!run.capacityPallets || run.capacityPallets <= 0 || run.plannedPallets <= 0) {
    return { family: run.palletFamily || "Unquantified", status: "Quantity unknown", note: "Excluded from pallet-capacity utilisation." };
  }
  return {
    capacity: run.capacityPallets,
    utilisation: run.utilisationPercent,
    family: `${run.palletFamily} · ${run.capacityPallets}`,
    status: utilisationStatus(run.utilisationPercent),
  };
}

function UtilisationBar({ value }: { value?: number }) {
  if (value == null) return <div style={{ fontSize: 12, opacity: 0.7 }}>No utilisation score</div>;
  const width = Math.min(Math.max(value, 0), 100);
  return <div style={{ marginTop: 7 }}>
    <div style={{ height: 9, borderRadius: 999, background: "#e6ece9", overflow: "hidden" }}>
      <div style={{ width: `${width}%`, height: "100%", background: value > 100 ? "#b42318" : value >= 80 ? "#2f6f44" : "#d69e2e" }} />
    </div>
    {value > 100 && <small style={{ color: "#b42318" }}>+{(value - 100).toFixed(1)}% above capacity</small>}
  </div>;
}

function HumanRunCard({ route }: { route: BetaLyonsPlanRoute }) {
  const util = humanUtilisation(route);
  return <article className="panel" style={{ padding: 12, display: "grid", gap: 5 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start", flexWrap: "wrap" }}>
      <div><strong>{route.reference}</strong><div><small>{route.orderLineCount} movement line{route.orderLineCount === 1 ? "" : "s"} · {qty(route.plannedPallets)}</small></div></div>
      <div style={{ textAlign: "right" }}><strong>{pct(util.utilisation)}</strong><div><small>{util.status}</small></div></div>
    </div>
    <UtilisationBar value={util.utilisation}/>
    <div><small><strong>Capacity basis:</strong> {util.family}</small></div>
    {util.note && <div><small>{util.note}</small></div>}
    <div><small>{route.routingAvailable ? miles(route.miles) : "HGV routing unavailable"} · {route.stops.join(" → ")}</small></div>
  </article>;
}

function RunCard({ run }: { run: BetaDayPlanRun }) {
  const util = betaUtilisation(run);
  return <article className="panel" style={{ padding: 12, display: "grid", gap: 5 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start", flexWrap: "wrap" }}>
      <div><strong>{run.reference}</strong> <small>· {run.period}</small><div><small>{run.orders.length} order line{run.orders.length === 1 ? "" : "s"} · {run.plannedPallets > 0 ? `${run.plannedPallets} pallets` : "quantity not stated"}</small></div></div>
      <div style={{ textAlign: "right" }}><strong>{pct(util.utilisation)}</strong><div><small>{util.status}</small></div></div>
    </div>
    <UtilisationBar value={util.utilisation}/>
    <div><small><strong>Capacity:</strong> {util.family}</small></div>
    <div><small>{run.routingAvailable ? miles(run.miles) : "HGV routing unavailable"}</small></div>
  </article>;
}

function weightedHumanUtilisation(routes: BetaLyonsPlanRoute[]) {
  let pallets = 0;
  let capacity = 0;
  for (const route of routes) {
    const util = humanUtilisation(route);
    if (!util.capacity || route.plannedPallets <= 0) continue;
    pallets += route.plannedPallets;
    capacity += util.capacity;
  }
  return capacity > 0 ? Math.round(pallets / capacity * 1000) / 10 : undefined;
}

function weightedBetaUtilisation(runs: BetaDayPlanRun[]) {
  const quantified = runs.filter(run => run.capacityPallets > 0 && run.plannedPallets > 0);
  const pallets = quantified.reduce((sum, run) => sum + run.plannedPallets, 0);
  const capacity = quantified.reduce((sum, run) => sum + run.capacityPallets, 0);
  return capacity > 0 ? Math.round(pallets / capacity * 1000) / 10 : undefined;
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
  const utilisationSummary = useMemo(() => comparison ? {
    human: weightedHumanUtilisation(comparison.lyons.routes),
    beta: weightedBetaUtilisation(comparison.beta.runs),
    humanOver: comparison.lyons.routes.filter(route => (humanUtilisation(route).utilisation ?? 0) > 100).length,
    humanUnder: comparison.lyons.routes.filter(route => {
      const value = humanUtilisation(route).utilisation;
      return value != null && value < 65;
    }).length,
    betaOver: comparison.beta.runs.filter(run => run.utilisationPercent > 100).length,
    betaUnder: comparison.beta.runs.filter(run => run.capacityPallets > 0 && run.utilisationPercent < 65).length,
  } : undefined, [comparison]);

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
        <p className="notice inline-notice"><strong>Capacity:</strong> BETA uses 26 Standard / 33 Euro pallets from the optimiser. Human runs use a clearly labelled visual capacity basis where the workbook does not explicitly state pallet family.</p>
        <p className="notice inline-notice"><strong>No invented capacity:</strong> missing pallet counts remain “quantity not stated”. Those movements remain in route/reconciliation evidence but are excluded from pallet-capacity utilisation.</p>
        <p className="notice inline-notice"><strong>Workbook rules:</strong> Lyons Collections reads only `Collection Plan`. Southbound uses its dedicated `Southbound`, `WAVE 3`, transfers/outbound and current market evidence.</p>
      </div>

      {fileNames.length > 0 && <p><small><strong>Selected:</strong> {fileNames.join(" + ")}</small></p>}
      {message && <p className="notice inline-notice">{message}</p>}
      {warnings.map((warning, index) => <p className="notice inline-notice" key={`${warning}-${index}`}>{warning}</p>)}
    </div>

    {comparison && <div className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Human vs BETA</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>
        <div className="panel" style={{ padding: 10 }}><small>Movement match</small><div><strong>{reconciliation?.matchedOrderLines}/{reconciliation?.betaOrderLines}</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Runs</small><div><strong>{comparison.lyons.routeCount} human → {comparison.beta.runCount} BETA</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Known pallets</small><div><strong>{comparison.lyons.totalPallets} human / {comparison.beta.totalPallets} BETA</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Utilisation score</small><div><strong>{pct(utilisationSummary?.human)} human → {pct(utilisationSummary?.beta)} BETA</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Human attention</small><div><strong>{utilisationSummary?.humanUnder ?? 0} under-used · {utilisationSummary?.humanOver ?? 0} over-capacity</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>BETA attention</small><div><strong>{utilisationSummary?.betaUnder ?? 0} under-used · {utilisationSummary?.betaOver ?? 0} over-capacity</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>HGV mileage</small><div><strong>{miles(comparison.lyons.totalMiles)} human / {miles(comparison.beta.totalMiles)} BETA</strong></div></div>
      </div>
      {!reconciliation?.comparableRouting && <p className="notice inline-notice"><strong>Mileage comparison withheld:</strong> exact work coverage and complete live HGV routing are required before Beta claims a saving.</p>}
      {reconciliation?.warnings.map((warning, index) => <p className="notice inline-notice" key={`${warning}-${index}`}>{warning}</p>)}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(430px,1fr))", gap: 14, alignItems: "start" }}>
        <section style={{ display: "grid", gap: 8 }}>
          <div><h3 style={{ marginBottom: 2 }}>Human plan · before</h3><small>Shows where manual planning left capacity unused or exceeded the likely trailer capacity.</small></div>
          {comparison.lyons.routes.map(route => <HumanRunCard key={route.reference} route={route}/>)}
        </section>
        <section style={{ display: "grid", gap: 8 }}>
          <div><h3 style={{ marginBottom: 2 }}>BETA plan · after</h3><small>Uses the optimiser's actual Standard/Euro capacity and utilisation score for each generated run.</small></div>
          {comparison.beta.runs.map(run => <RunCard key={run.reference} run={run}/>)}
        </section>
      </div>
    </div>}

    {dayPlan && !comparison && <div className="panel" style={{ padding: 16, display: "grid", gap: 8 }}>
      <h2 style={{ margin: 0 }}>Beta-built day · {formatDateLong(dayPlan.planningDate)}</h2>
      <p><small>{dayPlan.plannedOrderLines} planned order lines · {dayPlan.runCount} runs · {dayPlan.routingComplete ? "complete HGV routing" : "partial HGV routing"}</small></p>
      {dayPlan.warnings.map((warning, index) => <p className="notice inline-notice" key={`${warning}-${index}`}>{warning}</p>)}
      {dayPlan.runs.map(run => <RunCard key={run.reference} run={run}/>)}
    </div>}
  </section>;
}
