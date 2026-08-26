import { useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { intelligenceApi } from "../lib/intelligenceApi";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate, formatDateLong } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";

function feedAge(minutes?: number) {
  if (minutes == null) return "No receipt recorded";
  if (minutes < 1) return "Live";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function checkedAt(value?: string) {
  if (!value) return "Checking…";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DashboardOperational() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));
  const attention = useApi(useCallback(async () => intelligenceApi.attention(date, await token()), [date, token]));
  const freshness = useApi(useCallback(async () => intelligenceApi.freshness(await token()), [token]));
  const snapshot = readiness.data;
  const readyRuns = snapshot ? Math.max(0, snapshot.runs - snapshot.missingAllocations) : 0;
  const highAttention = attention.data?.items.filter((item) => item.severity === "High").length || 0;
  const refreshReadiness = readiness.refresh;
  const refreshAttention = attention.refresh;
  const refreshFreshness = freshness.refresh;

  const refreshAll = () => void Promise.all([refreshReadiness(), refreshAttention(), refreshFreshness()]);

  useEffect(() => {
    const refreshFeeds = () => void refreshFreshness();
    const interval = window.setInterval(refreshFeeds, 60_000);
    const onFocus = () => refreshFeeds();
    const onVisibility = () => { if (document.visibilityState === "visible") refreshFeeds(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshFreshness]);

  return <section className="dashboard-health-page">
    <div className="title-row dashboard-health-title">
      <div>
        <p className="eyebrow">Operational health · {formatDateLong(date)}</p>
        <h1>Today at a glance</h1>
        <p className="hint">A decision-focused view of today's orders, runs, people, fleet, exceptions and the systems feeding the operation.</p>
      </div>
      <button type="button" onClick={refreshAll} disabled={readiness.loading || attention.loading || freshness.loading}>Refresh all</button>
    </div>

    {readiness.error && <p className="notice inline-notice">Operational health could not refresh: {readiness.error}</p>}
    {snapshot && <>
      <div className={`dashboard-health-state ${snapshot.ready ? "good" : "attention"}`}>
        <div><span>{snapshot.ready ? "✓" : "!"}</span><div><small>Operational health</small><strong>{snapshot.ready ? "READY TO OPERATE" : "ACTION REQUIRED"}</strong></div></div>
        <p>{snapshot.runs} runs today · {readyRuns} fully allocated · {attention.data?.count || 0} active exception{attention.data?.count === 1 ? "" : "s"}</p>
      </div>

      <div className="dashboard-health-grid">
        <Link to="/staging"><article className={snapshot.unreviewedOrders ? "attention" : "good"}><span>Orders waiting</span><strong>{snapshot.unreviewedOrders}</strong><small>Need review / approval</small></article></Link>
        <Link to="/"><article className={snapshot.missingAllocations ? "attention" : "good"}><span>Runs ready</span><strong>{readyRuns}/{snapshot.runs}</strong><small>{snapshot.missingAllocations} need allocation</small></article></Link>
        <Link to="/fleet-assets"><article className={snapshot.vorConflicts ? "attention" : "good"}><span>Fleet / VOR</span><strong>{snapshot.vorConflicts}</strong><small>Conflicts against today's plan</small></article></Link>
        <Link to="/night-outs"><article className={snapshot.tachoConcerns ? "attention" : "good"}><span>Driver compliance</span><strong>{snapshot.tachoConcerns}</strong><small>Hours / Tacho concerns</small></article></Link>
        <Link to="/attention"><article className={highAttention ? "attention" : "good"}><span>High priority</span><strong>{highAttention}</strong><small>{attention.data?.count || 0} total exceptions</small></article></Link>
        <Link to="/loads"><article className={snapshot.planLock ? "good" : "neutral"}><span>Plan baseline</span><strong>{snapshot.planLock ? "Locked" : "Open"}</strong><small>{snapshot.planLock ? `${snapshot.planLock.baselineRuns} baseline runs` : "Not locked yet"}</small></article></Link>
      </div>
    </>}

    <div className="dashboard-health-columns">
      <section className="panel dashboard-attention-panel">
        <div className="title-row"><div><p className="eyebrow">Today's attention</p><h2>What needs a decision</h2></div><Link to="/attention">Open all →</Link></div>
        {attention.error && <p className="notice inline-notice">Exceptions could not refresh: {attention.error}</p>}
        {attention.data?.items.length ? <div className="dashboard-attention-list">{attention.data.items.slice(0, 6).map((item) => <Link key={item.id} to={item.href} className={`dashboard-attention-row severity-${item.severity.toLowerCase()}`}><span>{item.severity}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><b>→</b></Link>)}</div> : <p className="hint">No active operational exceptions are being reported for today.</p>}
      </section>

      <section className="panel dashboard-feed-panel">
        <div className="title-row"><div><p className="eyebrow">System feeds</p><h2>Are we receiving current data?</h2><small>Same receipt-state used by Control Centre · checks refresh every 60 seconds and whenever this screen regains focus.</small></div><Link to="/control-centre">Control centre →</Link></div>
        {freshness.error && <p className="notice inline-notice">Feed health could not refresh: {freshness.error}</p>}
        {freshness.data && <p className="hint">Last health check: <strong>{checkedAt(freshness.data.generatedAtUtc)}</strong>. Green means data is arriving within that provider's configured cadence; amber means unconfirmed/pending; red means stale or not configured.</p>}
        <div className="dashboard-feed-list">{freshness.data?.sources.map((feed) => <div key={feed.name} className={`dashboard-feed-row feed-${feed.state}`} title={feed.detail}><span aria-hidden="true" /><div><strong>{feed.name}</strong><small>{feedAge(feed.ageMinutes)}{feed.cadence ? ` · ${feed.cadence}` : ""}</small>{feed.detail && <small>{feed.detail}</small>}</div><b>{feed.state === "green" ? "CURRENT" : feed.state === "amber" ? "CHECK" : "ATTENTION"}</b></div>)}</div>
      </section>
    </div>

    <div className="dashboard-handoff-links"><Link to="/staging">Review orders →</Link><Link to="/">Planner →</Link><Link to="/pallet-control">Pallet control →</Link><Link to="/operations-wallboard">Live operations →</Link></div>
  </section>;
}
