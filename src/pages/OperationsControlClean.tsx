import { useCallback, useState } from "react";
import { api, request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

type LiveCoverageResponse = {
  generatedAtUtc: string;
  operatingDate: string;
  dot: {
    configured: boolean;
    provider: string;
    liveVehicleCount: number;
    movingVehicleCount: number;
    latestEventUtc?: string;
  };
  tachoMaster: {
    configured: boolean;
    connected: boolean;
    vehicleIdentityCount: number;
    dutyRecordCount: number;
    tachoMemberIdentityCount: number;
    liveOnlyIdentityCount: number;
    error?: string;
  };
  summary: {
    movingVehicles: number;
    movingWithTachoIdentity: number;
    movingWithTachoMemberMatch: number;
    movingWithLiveCardOrNameFromDot: number;
    movingWithoutTachoIdentity: number;
    attentionCount: number;
  };
  unmatchedMovingVehicles: Array<{
    vehicleIdentifier: string;
    lastEventUtc: string;
    speedKph?: number;
    dotDriverName?: string;
    dotDriverCardDetected: boolean;
    reason: string;
  }>;
};

function StatusCard({ title, configured, connected, detail, meta }: { title: string; configured?: boolean; connected?: boolean; detail: string; meta?: string }) {
  return <article className="admin-card">
    <span className={connected ? "integration-state ready" : "integration-state pending"}>
      {connected ? "Live" : configured ? "Configured" : "Setup needed"}
    </span>
    <h2>{title}</h2>
    <p>{detail}</p>
    {meta && <small>{meta}</small>}
  </article>;
}

export function OperationsControlClean() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const sage = useApi(useCallback(async () => api.sageHrStatus(await token()), [token]));
  const tacho = useApi(useCallback(async () => api.tachoMasterStatus(await token()), [token]));
  const road = useApi(useCallback(async () => api.roadTechStatus(await token()), [token]));
  const fleetio = useApi(useCallback(async () => api.fleetioStatus(await token()), [token]));
  const fleet = useApi(useCallback(async () => api.fleetStatus(await token()), [token]));
  const liveCoverage = useApi(useCallback(async () => request<LiveCoverageResponse>("/api/v1/operations/live-coverage", await token(), undefined, 45000), [token]));
  const exceptions = useApi(useCallback(async () => api.operationsExceptions(date, await token()), [date, token]));
  const reconciliation = useApi(useCallback(async () => api.operationsReconciliation(date, await token()), [date, token]));

  const moving = (fleet.data?.vehicles || []).filter((vehicle) => vehicle.condition === "Moving");
  const movingWithTachoFallback = moving.filter((vehicle) => Boolean(vehicle.tacho) || vehicle.driverSource === "TachoMaster").length;
  const movingCount = liveCoverage.data?.summary.movingVehicles ?? moving.length;
  const movingWithTacho = liveCoverage.data?.summary.movingWithTachoIdentity ?? movingWithTachoFallback;
  const movingWithTachoMember = liveCoverage.data?.summary.movingWithTachoMemberMatch ?? movingWithTachoFallback;
  const movingWithDotCard = liveCoverage.data?.summary.movingWithLiveCardOrNameFromDot ?? 0;
  const movingWithoutTacho = liveCoverage.data?.summary.movingWithoutTachoIdentity ?? Math.max(0, moving.length - movingWithTachoFallback);

  const refresh = () => {
    void sage.refresh();
    void tacho.refresh();
    void road.refresh();
    void fleetio.refresh();
    void fleet.refresh();
    void liveCoverage.refresh();
    void exceptions.refresh();
    void reconciliation.refresh();
  };

  return <section>
    <div className="title-row">
      <div><p className="eyebrow">Control & insight</p><h1>Operations control</h1></div>
      <div className="route-actions">
        <label>Operating date <input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <button onClick={refresh}>Refresh live checks</button>
      </div>
    </div>

    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row">
        <div><p className="eyebrow">Integration confidence</p><h2>Live provider status</h2></div>
        <small>DOT supplies live vehicle location; Tachomaster supplies driver/card identity and hours. Manual synchronisation is managed in Admin.</small>
      </div>
      <div className="admin-grid">
        <StatusCard
          title="Sage HR"
          configured={sage.data?.configured}
          connected={sage.data?.connected}
          detail={sage.data?.message || sage.error || "Checking Sage HR…"}
          meta={sage.data ? `${sage.data.employeeCount} active employees · ${sage.data.driverCandidateCount} driver candidates returned by Sage HR` : undefined}
        />
        <StatusCard
          title="TachoMaster"
          configured={liveCoverage.data?.tachoMaster.configured ?? tacho.data?.configured}
          connected={liveCoverage.data?.tachoMaster.connected ?? tacho.data?.connected}
          detail={liveCoverage.data
            ? liveCoverage.data.tachoMaster.error
              ? `Tachomaster identity check failed: ${liveCoverage.data.tachoMaster.error}`
              : `Tachomaster returned ${liveCoverage.data.tachoMaster.vehicleIdentityCount} live vehicle/driver identit${liveCoverage.data.tachoMaster.vehicleIdentityCount === 1 ? "y" : "ies"}.`
            : tacho.data?.message || tacho.error || "Checking TachoMaster…"}
          meta={liveCoverage.data
            ? `${liveCoverage.data.tachoMaster.dutyRecordCount} duty record candidates · ${liveCoverage.data.tachoMaster.tachoMemberIdentityCount} Tachomaster member matches · ${liveCoverage.data.tachoMaster.liveOnlyIdentityCount} live-only identities`
            : tacho.data ? `${tacho.data.matchedVehicleCount} current TachoMaster vehicle duty/card assignment${tacho.data.matchedVehicleCount === 1 ? "" : "s"}` : undefined}
        />
        <StatusCard
          title="DOT / RoadTech"
          configured={liveCoverage.data?.dot.configured ?? road.data?.configured}
          connected={Boolean(liveCoverage.data?.dot.liveVehicleCount) || road.data?.connected}
          detail={liveCoverage.data ? `${liveCoverage.data.dot.provider} returned ${liveCoverage.data.dot.liveVehicleCount} live vehicle location record${liveCoverage.data.dot.liveVehicleCount === 1 ? "" : "s"}.` : road.data?.message || road.error || "Checking DOT / RoadTech…"}
          meta={liveCoverage.data ? `${liveCoverage.data.dot.movingVehicleCount} moving now from DOT location/movement state` : road.data ? `${road.data.recordCount} latest vehicle telemetry records returned` : undefined}
        />
        <StatusCard
          title="Fleetio"
          configured={fleetio.data?.configured}
          connected={fleetio.data?.connected}
          detail={fleetio.data?.message || fleetio.error || "Checking Fleetio…"}
          meta={fleetio.data ? `${fleetio.data.sampleVehicleCount} sampled vehicle records` : undefined}
        />
      </div>

      <div className="metrics" style={{ marginTop: 16 }}>
        <article><span>Vehicles moving now</span><strong>{movingCount}</strong><small>DOT/RoadTech live location and movement state</small></article>
        <article><span>Moving + Tachomaster identity</span><strong>{movingWithTacho}</strong><small>Moving DOT vehicles matched to a Tachomaster vehicle/driver identity</small></article>
        <article><span>Tachomaster member matches</span><strong>{movingWithTachoMember}</strong><small>Moving vehicles where the driver/card links to a Tachomaster member</small></article>
        <article><span>DOT card/name seen</span><strong>{movingWithDotCard}</strong><small>Moving vehicles where DOT/Falcon exposed live card or driver identity evidence</small></article>
        <article className={movingWithoutTacho ? "warning" : ""}><span>Moving without Tachomaster match</span><strong>{movingWithoutTacho}</strong><small>{movingWithoutTacho ? "Review card/duty identity coverage; location itself is still confirmed by DOT." : "All moving vehicles have a Tachomaster identity match."}</small></article>
      </div>

      {liveCoverage.error && <p className="notice inline-notice">Live DOT/Tachomaster coverage check failed: {liveCoverage.error}</p>}
      {(liveCoverage.data?.unmatchedMovingVehicles || []).slice(0, 8).map((vehicle) => <div className="notice inline-notice" key={`${vehicle.vehicleIdentifier}-${vehicle.lastEventUtc}`}>
        <strong>{vehicle.vehicleIdentifier} · moving without Tachomaster match</strong><br />
        {vehicle.reason}{vehicle.dotDriverName ? ` DOT driver: ${vehicle.dotDriverName}.` : ""}{vehicle.dotDriverCardDetected ? " DOT card detected." : ""}
      </div>)}
    </section>

    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row"><div><p className="eyebrow">Exceptions</p><h2>Operational attention</h2></div><strong>{exceptions.data?.summary.total ?? "—"} open</strong></div>
      {exceptions.error ? <p className="notice inline-notice">{exceptions.error}</p> : exceptions.loading ? <p>Checking exceptions…</p> : (
        <>
          <div className="metrics">
            <article><span>High</span><strong>{exceptions.data?.summary.high ?? 0}</strong></article>
            <article><span>Medium</span><strong>{exceptions.data?.summary.medium ?? 0}</strong></article>
            <article><span>Low</span><strong>{exceptions.data?.summary.low ?? 0}</strong></article>
          </div>
          {(exceptions.data?.exceptions || []).slice(0, 12).map((item, index) => <div className="notice inline-notice" key={`${item.type}-${item.reference}-${index}`}><strong>{item.type} · {item.reference}</strong><br />{item.description}</div>)}
        </>
      )}
    </section>

    <section className="panel">
      <div className="title-row"><div><p className="eyebrow">Daily reconciliation</p><h2>Plan versus operational coverage</h2></div></div>
      {reconciliation.error ? <p className="notice inline-notice">{reconciliation.error}</p> : reconciliation.loading ? <p>Reconciling operational data…</p> : reconciliation.data && (
        <div className="metrics">
          <article><span>Orders</span><strong>{reconciliation.data.orders.total}</strong><small>{reconciliation.data.orders.readyToPlan} ready to plan</small></article>
          <article><span>Runs</span><strong>{reconciliation.data.loads.total}</strong><small>{reconciliation.data.loads.unallocated} unallocated</small></article>
          <article><span>Drivers</span><strong>{reconciliation.data.fleet.assignedDrivers}/{reconciliation.data.fleet.activeDrivers}</strong><small>assigned / active in TMS</small></article>
          <article><span>Vehicles</span><strong>{reconciliation.data.fleet.assignedVehicles}/{reconciliation.data.fleet.activeVehicles}</strong><small>assigned / active in TMS</small></article>
          <article><span>Vehicles seen today</span><strong>{reconciliation.data.fleet.vehiclesSeenToday}</strong><small>{reconciliation.data.fleet.vehiclesNoSignal} with no signal today</small></article>
          <article><span>Pending review</span><strong>{reconciliation.data.staging.pendingReview}</strong><small>staged records awaiting decision</small></article>
        </div>
      )}
    </section>
  </section>;
}
