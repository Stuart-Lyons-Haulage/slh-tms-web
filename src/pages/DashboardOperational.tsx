import { useCallback } from "react";
import { Link } from "react-router-dom";
import { intelligenceApi } from "../lib/intelligenceApi";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate, formatDateLong } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";
import { Dashboard as CoreDashboard } from "./Pages";
import { LiveRunsBoard } from "./LiveRunsBoard";

export function DashboardOperational() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));

  return <>
    <LiveRunsBoard />
    <section className="dashboard-readiness panel" style={{ marginTop: 20 }}>
      <div className="title-row">
        <div>
          <p className="eyebrow">Morning readiness · {formatDateLong(date)}</p>
          <h2>Today at a glance</h2>
          <p className="hint">A live picture of whether today’s plan is operationally ready. Plan locking is controlled from Runs.</p>
        </div>
        <button type="button" onClick={() => void readiness.refresh()} disabled={readiness.loading}>{readiness.loading ? "Refreshing…" : "Refresh readiness"}</button>
      </div>
      {readiness.error && <p className="notice inline-notice">Readiness could not refresh: {readiness.error}</p>}
      {readiness.data && <>
        <div className={`readiness-picture ${readiness.data.ready ? "ready" : "not-ready"}`}>
          <div className="readiness-picture-state">
            <span>{readiness.data.ready ? "✓" : "!"}</span>
            <div><strong>{readiness.data.ready ? "READY TO OPERATE" : "ACTION REQUIRED"}</strong><small>{readiness.data.runs} runs · {readiness.data.source || "TMS planning"}</small></div>
          </div>
          <div className="readiness-picture-grid">
            <article className={readiness.data.missingAllocations ? "attention" : "good"}><span>Allocations</span><strong>{readiness.data.runs - readiness.data.missingAllocations}/{readiness.data.runs}</strong><small>runs complete</small></article>
            <article className={readiness.data.vorConflicts ? "attention" : "good"}><span>VOR conflicts</span><strong>{readiness.data.vorConflicts}</strong><small>vehicle checks</small></article>
            <article className={readiness.data.tachoConcerns ? "attention" : "good"}><span>Tacho concerns</span><strong>{readiness.data.tachoConcerns}</strong><small>driver mappings</small></article>
            <article className={readiness.data.geofenceGaps ? "attention" : "good"}><span>Map gaps</span><strong>{readiness.data.geofenceGaps}</strong><small>stops to map</small></article>
            <article className={readiness.data.unreviewedOrders ? "attention" : "good"}><span>Unreviewed orders</span><strong>{readiness.data.unreviewedOrders}</strong><small>for today</small></article>
            <article className={readiness.data.planLock ? "good" : "neutral"}><span>Plan baseline</span><strong>{readiness.data.planLock ? "Locked" : "Open"}</strong><small>{readiness.data.planLock ? `${readiness.data.planLock.baselineRuns} runs` : "lock from Runs"}</small></article>
          </div>
        </div>
        <div className="readiness-links"><Link to="/loads">Open Runs / lock plan →</Link></div>
      </>}
    </section>
    <CoreDashboard />
  </>;
}
