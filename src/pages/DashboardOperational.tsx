import { useCallback } from "react";
import { Link } from "react-router-dom";
import { intelligenceApi } from "../lib/intelligenceApi";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate, formatDateLong } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";

export function DashboardOperational() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));
  const cardStyle = { color: "inherit", textDecoration: "none" };

  return <section className="dashboard-readiness panel">
    <div className="title-row">
      <div>
        <p className="eyebrow">Operational snapshot · {formatDateLong(date)}</p>
        <h2>Today at a glance</h2>
        <p className="hint">Only the controls that need a decision now. Select any box to open the detailed operational view.</p>
      </div>
      <button type="button" onClick={() => void readiness.refresh()} disabled={readiness.loading}>{readiness.loading ? "Refreshing…" : "Refresh"}</button>
    </div>
    {readiness.error && <p className="notice inline-notice">Snapshot could not refresh: {readiness.error}</p>}
    {readiness.data && <>
      <div className={`readiness-picture ${readiness.data.ready ? "ready" : "not-ready"}`}>
        <div className="readiness-picture-state">
          <span>{readiness.data.ready ? "✓" : "!"}</span>
          <div><strong>{readiness.data.ready ? "READY TO OPERATE" : "ACTION REQUIRED"}</strong><small>{readiness.data.runs} runs · {readiness.data.source || "TMS planning"}</small></div>
        </div>
        <div className="readiness-picture-grid">
          <Link to="/loads" style={cardStyle} aria-label="Open run allocations">
            <article className={readiness.data.missingAllocations ? "attention" : "good"}><span>Allocations</span><strong>{readiness.data.runs - readiness.data.missingAllocations}/{readiness.data.runs}</strong><small>runs complete · view runs →</small></article>
          </Link>
          <Link to="/fleet-assets" style={cardStyle} aria-label="Open fleet and VOR checks">
            <article className={readiness.data.vorConflicts ? "attention" : "good"}><span>Fleet / VOR</span><strong>{readiness.data.vorConflicts}</strong><small>conflicts · view fleet →</small></article>
          </Link>
          <Link to="/night-outs" style={cardStyle} aria-label="Open driver hours and compliance">
            <article className={readiness.data.tachoConcerns ? "attention" : "good"}><span>Driver compliance</span><strong>{readiness.data.tachoConcerns}</strong><small>hours / Tacho concerns · view →</small></article>
          </Link>
          <Link to="/staging" style={cardStyle} aria-label="Open orders awaiting review">
            <article className={readiness.data.unreviewedOrders ? "attention" : "good"}><span>Review orders</span><strong>{readiness.data.unreviewedOrders}</strong><small>awaiting decision · review →</small></article>
          </Link>
          <Link to="/loads" style={cardStyle} aria-label="Open plan baseline and locking">
            <article className={readiness.data.planLock ? "good" : "neutral"}><span>Plan baseline</span><strong>{readiness.data.planLock ? "Locked" : "Open"}</strong><small>{readiness.data.planLock ? `${readiness.data.planLock.baselineRuns} runs · inspect →` : "lock from Runs →"}</small></article>
          </Link>
        </div>
      </div>
      <div className="readiness-links"><Link to="/loads">Runs →</Link><Link to="/live-runs">Live operations →</Link><Link to="/">Planner →</Link></div>
    </>}
  </section>;
}
