import { useCallback, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { intelligenceApi } from "../lib/intelligenceApi";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate, formatDateLong } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";
import { startVisiblePolling } from "../lib/visiblePolling";
import { DailyAllocationViewer } from "../components/DailyAllocationViewer";

type FleetioLiveStatus = {
  connected: boolean;
  retrievedAtUtc: string;
  vehicles: Array<{ tmsVehicleId?: string; fleetioStatus?: string }>;
};

type DailyComplianceSummary = {
  generatedAtUtc: string;
  sourceStatus: { tachoMaster: string; fleetio: string; dotFalcon: string; tms: string };
  summary: { green: number; amber: number; red: number };
};

function feedAge(minutes?: number) { if (minutes == null) return "No receipt recorded"; if (minutes < 1) return "Live"; if (minutes < 60) return `${Math.round(minutes)}m ago`; return `${Math.round(minutes / 60)}h ago`; }
function checkedAt(value?: string) { if (!value) return "Checking…"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function isVorStatus(value?: string) { return /\bVOR\b|out of service|out-of-service/i.test(value || ""); }

export function DashboardOperational() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));
  const attention = useApi(useCallback(async () => intelligenceApi.attention(date, await token()), [date, token]));
  const freshness = useApi(useCallback(async () => intelligenceApi.freshness(await token()), [token]));
  const liveFleet = useApi(useCallback(async () => request<FleetioLiveStatus>("/api/v1/integrations/fleetio/asset-status", await token(), undefined, 60000), [token]));
  const compliance = useApi(useCallback(async () => request<DailyComplianceSummary>(`/api/v1/daily-compliance/report?date=${encodeURIComponent(date)}`, await token(), undefined, 90000), [date, token]));
  const snapshot = readiness.data;
  const readyRuns = snapshot ? Math.max(0, snapshot.runs - snapshot.missingAllocations) : 0;
  const highAttention = attention.data?.items.filter(item => item.severity === "High").length || 0;
  const assignedVehicleIds = useMemo(() => new Set(snapshot?.assignedVehicleIds || []), [snapshot?.assignedVehicleIds]);
  const liveVorConflicts = liveFleet.data && snapshot?.assignedVehicleIds
    ? liveFleet.data.vehicles.filter(vehicle => vehicle.tmsVehicleId && assignedVehicleIds.has(vehicle.tmsVehicleId) && isVorStatus(vehicle.fleetioStatus)).length
    : snapshot?.vorConflicts || 0;
  const complianceConcerns = compliance.data ? compliance.data.summary.amber + compliance.data.summary.red : snapshot?.tachoConcerns || 0;
  const complianceBlocking = compliance.data ? compliance.data.summary.red : snapshot?.tachoConcerns || 0;
  const operationalReady = snapshot
    ? snapshot.runs > 0 && snapshot.missingAllocations === 0 && liveVorConflicts === 0 && complianceBlocking === 0 && snapshot.geofenceGaps === 0 && snapshot.unreviewedOrders === 0
    : false;

  const refreshReadiness = readiness.refresh;
  const refreshAttention = attention.refresh;
  const refreshFreshness = freshness.refresh;
  const refreshFleet = liveFleet.refresh;
  const refreshCompliance = compliance.refresh;
  const refreshCore = useCallback(() => Promise.allSettled([refreshReadiness(), refreshAttention(), refreshFreshness()]).then(() => undefined), [refreshAttention, refreshFreshness, refreshReadiness]);
  const refreshLiveCompliance = useCallback(() => Promise.allSettled([refreshFleet(), refreshCompliance()]).then(() => undefined), [refreshCompliance, refreshFleet]);
  const refreshAll = useCallback(() => Promise.allSettled([refreshCore(), refreshLiveCompliance()]).then(() => undefined), [refreshCore, refreshLiveCompliance]);

  useEffect(() => startVisiblePolling(refreshCore, 60_000), [refreshCore]);
  useEffect(() => startVisiblePolling(refreshLiveCompliance, 300_000), [refreshLiveCompliance]);

  return <section className="dashboard-health-page">
    <div className="title-row dashboard-health-title"><div><p className="eyebrow">Operational health · {formatDateLong(date)}</p><h1>Today at a glance</h1><p className="hint">A decision-focused view of today's loads, runs, people, fleet, exceptions and the systems feeding the operation.</p></div><button type="button" onClick={() => void refreshAll()} disabled={readiness.loading || attention.loading || freshness.loading || liveFleet.loading || compliance.loading}>Refresh all</button></div>
    {readiness.error && <p className="notice inline-notice">Operational health could not refresh: {readiness.error}</p>}
    {liveFleet.error && <p className="notice inline-notice">Live Fleetio status could not refresh; the dashboard is temporarily using the last reconciled TMS Fleetio state: {liveFleet.error}</p>}
    {compliance.error && <p className="notice inline-notice">Live driver compliance could not refresh; the dashboard is temporarily using the readiness fallback: {compliance.error}</p>}
    {snapshot && <><div className={`dashboard-health-state ${operationalReady ? "good" : "attention"}`}><div><span>{operationalReady ? "✓" : "!"}</span><div><small>Operational health</small><strong>{operationalReady ? "READY TO OPERATE" : "ACTION REQUIRED"}</strong></div></div><p>{snapshot.runs} runs today · {readyRuns} fully allocated · {attention.data?.count || 0} active exception{attention.data?.count === 1 ? "" : "s"}</p></div><div className="dashboard-health-grid"><Link to="/staging"><article className={snapshot.unreviewedOrders ? "attention" : "good"}><span>Loads waiting</span><strong>{snapshot.unreviewedOrders}</strong><small>Need review / approval</small></article></Link><Link to="/driver-dispatch"><article className={snapshot.missingAllocations ? "attention" : "good"}><span>Runs ready</span><strong>{readyRuns}/{snapshot.runs}</strong><small>{snapshot.missingAllocations} need allocation</small></article></Link><Link to="/fleet-assets"><article className={liveVorConflicts ? "attention" : "good"}><span>Fleet / VOR</span><strong>{liveVorConflicts}</strong><small>{liveFleet.data ? `Live Fleetio · ${checkedAt(liveFleet.data.retrievedAtUtc)}` : "Reconciled Fleetio fallback"}</small></article></Link><Link to="/daily-compliance"><article className={complianceBlocking ? "attention" : complianceConcerns ? "neutral" : "good"}><span>Driver compliance</span><strong>{complianceConcerns}</strong><small>{compliance.data ? `${compliance.data.summary.red} action · ${compliance.data.summary.amber} review / paper` : "Tacho readiness fallback"}</small></article></Link><Link to="/attention"><article className={highAttention ? "attention" : "good"}><span>High priority</span><strong>{highAttention}</strong><small>{attention.data?.count || 0} total exceptions</small></article></Link></div></>}
    <DailyAllocationViewer initialDate={date} />
    <div className="dashboard-health-columns"><section className="panel dashboard-attention-panel"><div className="title-row"><div><p className="eyebrow">Today's attention</p><h2>What needs a decision</h2></div><Link to="/attention">Open all →</Link></div>{attention.error && <p className="notice inline-notice">Exceptions could not refresh: {attention.error}</p>}{attention.data?.items.length ? <div className="dashboard-attention-list">{attention.data.items.slice(0, 6).map(item => <Link key={item.id} to={item.type === "OrderReview" && item.entityId ? `/staging?reviewId=${encodeURIComponent(item.entityId)}&sourceEmail=1` : item.href} className={`dashboard-attention-row severity-${item.severity.toLowerCase()}`}><span>{item.severity}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><b>→</b></Link>)}</div> : <p className="hint">No active operational exceptions are being reported for today.</p>}</section><section className="panel dashboard-feed-panel"><div className="title-row"><div><p className="eyebrow">System feeds</p><h2>Are we receiving current data?</h2><small>Same receipt-state used by Control Centre · checks refresh about every 60 seconds while visible and immediately when this screen regains focus.</small></div><Link to="/control-centre">Control centre →</Link></div>{freshness.error && <p className="notice inline-notice">Feed health could not refresh: {freshness.error}</p>}{freshness.data && <p className="hint">Last health check: <strong>{checkedAt(freshness.data.generatedAtUtc)}</strong>. Green means data is arriving within that provider's configured cadence; amber means unconfirmed/pending; red means stale or not configured.</p>}<div className="dashboard-feed-list">{freshness.data?.sources.map(feed => <div key={feed.name} className={`dashboard-feed-row feed-${feed.state}`} title={feed.detail}><span aria-hidden="true" /><div><strong>{feed.name}</strong><small>{feedAge(feed.ageMinutes)}{feed.cadence ? ` · ${feed.cadence}` : ""}</small>{feed.detail && <small>{feed.detail}</small>}</div><b>{feed.state === "green" ? "CURRENT" : feed.state === "amber" ? "CHECK" : "ATTENTION"}</b></div>)}</div></section></div>
    <div className="dashboard-handoff-links"><Link to="/staging">Load Review →</Link><Link to="/">Planner →</Link><Link to="/driver-dispatch">Driver Dispatch →</Link><Link to="/operations-wallboard">Live operations →</Link></div>
  </section>;
}
