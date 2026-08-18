import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { formatDate, todayIsoDate } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";

export function ReportingOperational() {
  const token = useAccessToken();
  const [date, setDate] = useState(todayIsoDate());
  const reconciliation = useApi(useCallback(async () => api.operationsReconciliation(date, await token()), [date, token]));
  const exceptions = useApi(useCallback(async () => api.operationsExceptions(date, await token()), [date, token]));
  const refresh = () => { void reconciliation.refresh(); void exceptions.refresh(); };

  return <section>
    <div className="title-row">
      <div><p className="eyebrow">Operational reporting</p><h1>Daily transport report</h1><p className="intro">Planning, fleet coverage and operational exceptions only. Commercial rates, costs and margins are not part of the TMS.</p></div>
      <div className="route-actions"><label>Report date <input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button onClick={refresh}>Refresh</button></div>
    </div>
    {(reconciliation.error || exceptions.error) && <p className="notice inline-notice">{reconciliation.error || exceptions.error}</p>}
    <section className="panel">
      <div className="title-row"><div><p className="eyebrow">{formatDate(date)}</p><h2>Plan & resource position</h2></div></div>
      {reconciliation.loading ? <p>Loading operational totals…</p> : reconciliation.data && <div className="metrics">
        <article><span>Orders</span><strong>{reconciliation.data.orders.total}</strong><small>{reconciliation.data.orders.readyToPlan} ready to plan</small></article>
        <article><span>Runs</span><strong>{reconciliation.data.loads.total}</strong><small>{reconciliation.data.loads.unallocated} unallocated</small></article>
        <article><span>Drivers assigned</span><strong>{reconciliation.data.fleet.assignedDrivers}/{reconciliation.data.fleet.activeDrivers}</strong><small>assigned / active</small></article>
        <article><span>Vehicles assigned</span><strong>{reconciliation.data.fleet.assignedVehicles}/{reconciliation.data.fleet.activeVehicles}</strong><small>assigned / active</small></article>
        <article><span>Vehicles seen</span><strong>{reconciliation.data.fleet.vehiclesSeenToday}</strong><small>{reconciliation.data.fleet.vehiclesNoSignal} with no signal</small></article>
        <article><span>Pending review</span><strong>{reconciliation.data.staging.pendingReview}</strong><small>awaiting decision</small></article>
      </div>}
    </section>
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="title-row"><div><p className="eyebrow">Operational exceptions</p><h2>What needs intervention</h2></div><strong>{exceptions.data?.summary.total ?? "—"} open</strong></div>
      {exceptions.loading ? <p>Checking exceptions…</p> : exceptions.data && <>
        <div className="metrics"><article><span>High</span><strong>{exceptions.data.summary.high}</strong></article><article><span>Medium</span><strong>{exceptions.data.summary.medium}</strong></article><article><span>Low</span><strong>{exceptions.data.summary.low}</strong></article></div>
        <div style={{ marginTop: 14 }}>{exceptions.data.exceptions.length === 0 ? <p className="hint">No operational exceptions for this date.</p> : exceptions.data.exceptions.map((item, index) => <div className="notice inline-notice" key={`${item.type}-${item.reference}-${index}`}><strong>{item.severity} · {item.type} · {item.reference}</strong><br />{item.description}</div>)}</div>
      </>}
    </section>
  </section>;
}
