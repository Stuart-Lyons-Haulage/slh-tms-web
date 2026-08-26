import { useCallback, useEffect } from "react";
import { ApiError, api, request } from "../lib/api";
import { intelligenceApi, type FreshnessSource } from "../lib/intelligenceApi";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";

type LiveCoverageResponse = {
  generatedAtUtc: string;
  operatingDate: string;
  dot: { configured: boolean; provider: string; liveVehicleCount: number; movingVehicleCount: number; latestEventUtc?: string };
  tachoMaster: { configured: boolean; connected: boolean; vehicleIdentityCount: number; dutyRecordCount: number; tachoMemberIdentityCount: number; liveOnlyIdentityCount: number; driverProfileCount?: number; error?: string };
  summary: { movingVehicles: number; movingWithTachoIdentity: number; movingWithTachoMemberMatch: number; movingWithLiveCardOrNameFromDot: number; movingWithoutTachoIdentity: number; attentionCount: number; movingWithLiveTachoIdentity?: number; movingWithLiveTachoMemberMatch?: number; movingWithTachoDirectoryProfile?: number; movingWithPlannedAllocation?: number };
  unmatchedMovingVehicles: Array<{ vehicleIdentifier: string; lastEventUtc: string; speedKph?: number; dotDriverName?: string; dotDriverCardDetected: boolean; plannedDriverName?: string; plannedLoadReference?: string; reason: string }>;
};

function receiptTime(value?: string) {
  if (!value) return "no receipt recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-GB");
}

function StatusCard({ title, configured, connected, detail, meta, receipt }: { title: string; configured?: boolean; connected?: boolean; detail: string; meta?: string; receipt?: FreshnessSource }) {
  const receiptCurrent = receipt?.state === "green";
  const ready = Boolean(connected) && (receipt ? receiptCurrent : true);
  const label = receipt
    ? receipt.state === "green"
      ? "Connected · current"
      : connected
        ? receipt.state === "red" ? "Connected · stale" : "Connected · check"
        : configured ? "Configured · no current receipt" : "Setup needed"
    : connected ? "Live" : configured ? "Configured" : "Setup needed";
  const receiptMeta = receipt ? `Last receipt ${receiptTime(receipt.lastUpdatedUtc)}${receipt.cadence ? ` · ${receipt.cadence}` : ""}` : undefined;
  return <article className="admin-card"><span className={ready ? "integration-state ready" : "integration-state pending"}>{label}</span><h2>{title}</h2><p>{detail}</p>{meta && <small>{meta}</small>}{receiptMeta && <small style={{ display: "block", marginTop: 4 }}>{receiptMeta}</small>}</article>;
}

export function OperationsControlClean() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const sage = useApi(useCallback(async () => api.sageHrStatus(await token()), [token]));
  const tacho = useApi(useCallback(async () => api.tachoMasterStatus(await token()), [token]));
  const road = useApi(useCallback(async () => api.roadTechStatus(await token()), [token]));
  const fleetio = useApi(useCallback(async () => api.fleetioStatus(await token()), [token]));
  const fleet = useApi(useCallback(async () => api.fleetStatus(await token()), [token]));
  const feedHealth = useApi(useCallback(async () => intelligenceApi.freshness(await token()), [token]));
  const liveCoverage = useApi(useCallback(async () => {
    const authToken = await token();
    try { return await request<LiveCoverageResponse>("/api/v1/operations/live-coverage", authToken, undefined, 45000); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
  }, [token]));
  const exceptions = useApi(useCallback(async () => api.operationsExceptions(date, await token()), [date, token]));
  const reconciliation = useApi(useCallback(async () => api.operationsReconciliation(date, await token()), [date, token]));

  const moving = (fleet.data?.vehicles || []).filter((vehicle) => vehicle.condition === "Moving");
  const movingWithTachoFallback = moving.filter((vehicle) => Boolean(vehicle.tacho) || vehicle.driverSource === "TachoMaster").length;
  const movingWithDotIdentityFallback = moving.filter((vehicle) => vehicle.driverSource === "DOT/Falcon" || Boolean(vehicle.driverName)).length;
  const movingCount = liveCoverage.data?.summary.movingVehicles ?? moving.length;
  const movingWithTacho = liveCoverage.data?.summary.movingWithTachoIdentity ?? movingWithTachoFallback;
  const liveTachoConfirmed = liveCoverage.data?.summary.movingWithLiveTachoIdentity ?? movingWithTachoFallback;
  const allocationTachoProfiles = liveCoverage.data?.summary.movingWithTachoDirectoryProfile ?? 0;
  const plannedAllocations = liveCoverage.data?.summary.movingWithPlannedAllocation ?? 0;
  const movingWithTachoMember = liveCoverage.data?.summary.movingWithTachoMemberMatch ?? movingWithTachoFallback;
  const movingWithDotCard = liveCoverage.data?.summary.movingWithLiveCardOrNameFromDot ?? movingWithDotIdentityFallback;
  const movingWithoutTacho = liveCoverage.data?.summary.movingWithoutTachoIdentity ?? Math.max(0, moving.length - movingWithTachoFallback);
  const receipt = (name: string) => feedHealth.data?.sources.find((feed) => feed.name === name);
  const refreshSage = sage.refresh;
  const refreshTacho = tacho.refresh;
  const refreshRoad = road.refresh;
  const refreshFleetio = fleetio.refresh;
  const refreshFleet = fleet.refresh;
  const refreshFeedHealth = feedHealth.refresh;
  const refreshLiveCoverage = liveCoverage.refresh;
  const refreshExceptions = exceptions.refresh;
  const refreshReconciliation = reconciliation.refresh;

  const refresh = useCallback(() => {
    void refreshSage();
    void refreshTacho();
    void refreshRoad();
    void refreshFleetio();
    void refreshFleet();
    void refreshFeedHealth();
    void refreshLiveCoverage();
    void refreshExceptions();
    void refreshReconciliation();
  }, [refreshSage, refreshTacho, refreshRoad, refreshFleetio, refreshFleet, refreshFeedHealth, refreshLiveCoverage, refreshExceptions, refreshReconciliation]);

  useEffect(() => {
    const interval = window.setInterval(refresh, 60_000);
    const onFocus = () => refresh();
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return <section>
    <div className="title-row"><div><p className="eyebrow">Control & insight</p><h1>Operations control</h1><p className="hint">Connection and receipt health refresh every 60 seconds and whenever this screen regains focus. Green now means the provider is connected and data is being received within its expected cadence.</p></div><button onClick={refresh}>Refresh live checks</button></div>

    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row"><div><p className="eyebrow">Integration confidence</p><h2>Live provider + receipt status</h2></div><small>Dashboard and Control Centre now share the same receipt-state. Connection alone no longer makes a stale feed green.</small></div>
      {feedHealth.error && <p className="notice inline-notice">Receipt health could not refresh: {feedHealth.error}</p>}
      <div className="admin-grid">
        <StatusCard title="Sage HR" configured={sage.data?.configured} connected={sage.data?.connected} receipt={receipt("Sage HR")} detail={sage.data?.message || sage.error || "Checking Sage HR…"} meta={sage.data ? `${sage.data.employeeCount} active employees · ${sage.data.driverCandidateCount} driver candidates returned by Sage HR` : undefined} />
        <StatusCard title="TachoMaster" configured={liveCoverage.data?.tachoMaster.configured ?? tacho.data?.configured} connected={liveCoverage.data?.tachoMaster.connected ?? tacho.data?.connected} receipt={receipt("TachoMaster")} detail={liveCoverage.data ? liveCoverage.data.tachoMaster.error ? `Tachomaster identity check failed: ${liveCoverage.data.tachoMaster.error}` : `Tachomaster returned ${liveCoverage.data.tachoMaster.vehicleIdentityCount} live vehicle/card identities and ${liveCoverage.data.tachoMaster.driverProfileCount ?? 0} driver profiles.` : tacho.data?.message || tacho.error || "Checking TachoMaster…"} meta={liveCoverage.data ? `${liveCoverage.data.tachoMaster.dutyRecordCount} duty candidates · ${liveCoverage.data.tachoMaster.tachoMemberIdentityCount} live member matches` : tacho.data ? `${tacho.data.matchedVehicleCount} current TachoMaster vehicle duty/card assignments` : undefined} />
        <StatusCard title="DOT / RoadTech" configured={liveCoverage.data?.dot.configured ?? road.data?.configured} connected={Boolean(liveCoverage.data?.dot.liveVehicleCount) || road.data?.connected} receipt={receipt("Tracking")} detail={liveCoverage.data ? `${liveCoverage.data.dot.provider} returned ${liveCoverage.data.dot.liveVehicleCount} live vehicle location records.` : road.data?.message || road.error || "Checking DOT / RoadTech…"} meta={liveCoverage.data ? `${liveCoverage.data.dot.movingVehicleCount} moving now` : road.data ? `${road.data.recordCount} latest vehicle telemetry records returned` : undefined} />
        <StatusCard title="Fleetio" configured={fleetio.data?.configured} connected={fleetio.data?.connected} receipt={receipt("Fleetio")} detail={fleetio.data?.message || fleetio.error || "Checking Fleetio…"} meta={fleetio.data ? `${fleetio.data.sampleVehicleCount} sampled vehicle records` : undefined} />
      </div>
      <div className="metrics" style={{ marginTop: 16 }}>
        <article><span>Vehicles moving now</span><strong>{movingCount}</strong><small>DOT/RoadTech live movement</small></article>
        <article><span>Live Tachomaster card confirmed</span><strong>{liveTachoConfirmed}</strong><small>Direct live identity</small></article>
        <article><span>Allocation + Tachomaster profile</span><strong>{allocationTachoProfiles}</strong><small>TMS driver enriched from Tachomaster</small></article>
        <article><span>Total Tachomaster coverage</span><strong>{movingWithTacho}</strong><small>Live + allocation-backed coverage</small></article>
        <article><span>Planned allocations seen</span><strong>{plannedAllocations}</strong><small>Moving vehicles linked to runs</small></article>
        <article><span>DOT card/name seen</span><strong>{movingWithDotCard}</strong><small>Live DOT identity evidence</small></article>
        <article><span>Tachomaster member/profile matches</span><strong>{movingWithTachoMember}</strong><small>Matched driver identities</small></article>
        <article className={movingWithoutTacho ? "warning" : ""}><span>Moving without Tachomaster coverage</span><strong>{movingWithoutTacho}</strong><small>{movingWithoutTacho ? "Review card, allocation or directory matching." : "All moving vehicles covered."}</small></article>
      </div>
      {liveCoverage.data === null && <p className="notice inline-notice">The upgraded live coverage API is still deploying, so this panel is temporarily using the existing DOT/Tachomaster fleet-status join.</p>}
      {liveCoverage.error && <p className="notice inline-notice">Live DOT/Tachomaster coverage check failed: {liveCoverage.error}</p>}
      {(liveCoverage.data?.unmatchedMovingVehicles || []).slice(0, 8).map((vehicle) => <div className="notice inline-notice" key={`${vehicle.vehicleIdentifier}-${vehicle.lastEventUtc}`}><strong>{vehicle.vehicleIdentifier} · moving without Tachomaster coverage</strong><br />{vehicle.reason}{vehicle.dotDriverName ? ` DOT driver: ${vehicle.dotDriverName}.` : ""}{vehicle.plannedDriverName ? ` Planned driver: ${vehicle.plannedDriverName}.` : ""}{vehicle.plannedLoadReference ? ` Run: ${vehicle.plannedLoadReference}.` : ""}</div>)}
    </section>

    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row"><div><p className="eyebrow">Today’s exceptions</p><h2>Operational attention</h2></div><strong>{exceptions.data?.summary.total ?? "—"} open</strong></div>
      {exceptions.error ? <p className="notice inline-notice">{exceptions.error}</p> : exceptions.loading ? <p>Checking exceptions…</p> : <><div className="metrics"><article><span>High</span><strong>{exceptions.data?.summary.high ?? 0}</strong></article><article><span>Medium</span><strong>{exceptions.data?.summary.medium ?? 0}</strong></article><article><span>Low</span><strong>{exceptions.data?.summary.low ?? 0}</strong></article></div>{(exceptions.data?.exceptions || []).slice(0, 12).map((item, index) => <div className="notice inline-notice" key={`${item.type}-${item.reference}-${index}`}><strong>{item.type} · {item.reference}</strong><br />{item.description}</div>)}</>}
    </section>

    <section className="panel">
      <div className="title-row"><div><p className="eyebrow">Today’s reconciliation</p><h2>Plan versus operational coverage</h2></div></div>
      {reconciliation.error ? <p className="notice inline-notice">{reconciliation.error}</p> : reconciliation.loading ? <p>Reconciling operational data…</p> : reconciliation.data && <div className="metrics"><article><span>Orders</span><strong>{reconciliation.data.orders.total}</strong><small>{reconciliation.data.orders.readyToPlan} ready to plan</small></article><article><span>Runs</span><strong>{reconciliation.data.loads.total}</strong><small>{reconciliation.data.loads.unallocated} unallocated</small></article><article><span>Drivers</span><strong>{reconciliation.data.fleet.assignedDrivers}/{reconciliation.data.fleet.activeDrivers}</strong><small>assigned / active</small></article><article><span>Vehicles</span><strong>{reconciliation.data.fleet.assignedVehicles}/{reconciliation.data.fleet.activeVehicles}</strong><small>assigned / active</small></article><article><span>Vehicles seen today</span><strong>{reconciliation.data.fleet.vehiclesSeenToday}</strong><small>{reconciliation.data.fleet.vehiclesNoSignal} with no signal</small></article><article><span>Pending review</span><strong>{reconciliation.data.staging.pendingReview}</strong><small>staged records awaiting decision</small></article></div>}
    </section>
  </section>;
}
