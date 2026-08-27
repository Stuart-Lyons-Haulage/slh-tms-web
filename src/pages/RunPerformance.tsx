import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DeliveryEta, type DriverAssignment } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const riskRank: Record<DeliveryEta["risk"], number> = { Late: 3, AtRisk: 2, Pending: 1, OnTrack: 0 };
const formatTime = (value?: string) => value ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "—";

function worstRisk(records: DeliveryEta[]) {
  return [...records].sort((left, right) => riskRank[right.risk] - riskRank[left.risk])[0];
}

export function RunPerformance() {
  const token = useAccessToken();
  const [date, setDate] = useState(today());
  const assignments = useApi(useCallback(async () => api.driverAssignments(date, date, await token()), [date, token]));
  const etas = useApi(useCallback(async () => api.deliveryEtas(date, await token()), [date, token]));

  const rows = useMemo(() => {
    const etaByLoad = new Map<string, DeliveryEta[]>();
    for (const eta of etas.data?.records || []) {
      const bucket = etaByLoad.get(eta.loadId) || [];
      bucket.push(eta);
      etaByLoad.set(eta.loadId, bucket);
    }
    return (assignments.data || []).map((run: DriverAssignment) => {
      const runEtas = etaByLoad.get(run.loadId) || [];
      const worst = worstRisk(runEtas);
      const finalEta = [...runEtas].sort((a, b) => b.sequence - a.sequence)[0];
      const completed = /completed|delivered/i.test(run.status);
      return { run, worst, finalEta, completed };
    }).sort((left, right) => {
      const leftRank = left.worst ? riskRank[left.worst.risk] : -1;
      const rightRank = right.worst ? riskRank[right.worst.risk] : -1;
      return rightRank - leftRank || left.run.loadReference.localeCompare(right.run.loadReference);
    });
  }, [assignments.data, etas.data]);

  const late = rows.filter(row => row.worst?.risk === "Late").length;
  const atRisk = rows.filter(row => row.worst?.risk === "AtRisk").length;
  const onTrack = rows.filter(row => row.worst?.risk === "OnTrack").length;
  const completed = rows.filter(row => row.completed).length;

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Management · KPI → Run → Evidence</p>
        <h1>Run Performance & Timelines</h1>
        <p className="hint">Start with the operational KPI, then open the exact run timeline to see allocation, dispatch, tracking, geofence, ETA and completion evidence.</p>
      </div>
      <label>Operating date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    </div>

    {(assignments.error || etas.error) && <p className="notice inline-notice">Some run-performance evidence could not refresh: {assignments.error || etas.error}</p>}
    <div className="metrics">
      <article className="metric"><span>Runs</span><strong>{rows.length}</strong><small>Committed run records</small></article>
      <article className="metric"><span>Completed</span><strong>{completed}</strong><small>{rows.length ? `${Math.round(completed / rows.length * 100)}%` : "—"} completed</small></article>
      <article className="metric"><span>Late</span><strong>{late}</strong><small>Worst stop currently late</small></article>
      <article className="metric"><span>At risk</span><strong>{atRisk}</strong><small>Needs operational attention</small></article>
      <article className="metric"><span>On track</span><strong>{onTrack}</strong><small>ETA evidence on target</small></article>
    </div>

    {(assignments.loading || etas.loading) && !assignments.data && <div className="state">Building run performance from allocations and ETA evidence…</div>}
    <div className="panel" style={{ overflowX: "auto" }}>
      <table style={{ minWidth: 980 }}>
        <thead><tr><th>Run</th><th>Driver</th><th>Vehicle</th><th>Status</th><th>ETA risk</th><th>Final stop</th><th>Final ETA</th><th>Evidence</th></tr></thead>
        <tbody>{rows.map(({ run, worst, finalEta }) => <tr key={run.loadId}>
          <td><strong>{run.loadReference}</strong></td>
          <td>{run.driver?.displayName || "Unallocated"}</td>
          <td>{run.vehicle?.registration || "—"}</td>
          <td>{run.status}</td>
          <td><strong>{worst?.risk || "No ETA"}</strong>{worst?.tachoStatus && <><br/><small>{worst.tachoStatus}</small></>}</td>
          <td>{run.finalStop || finalEta?.stopName || "—"}</td>
          <td>{formatTime(finalEta?.etaUtc)}</td>
          <td><Link to={`/timeline/run/${run.loadId}`}>Open timeline →</Link></td>
        </tr>)}</tbody>
      </table>
      {!assignments.loading && rows.length === 0 && <p className="hint">No run records are available for this date.</p>}
    </div>

    <div className="panel">
      <strong>Management drill-down</strong>
      <p style={{ marginBottom: 0 }}>Use this screen for the day-level run list and timeline evidence. The existing Management and Plan Stability pages remain the longer-range KPI views for on-time delivery, utilisation, plan changes, driver swaps and route amendments.</p>
    </div>
  </section>;
}
