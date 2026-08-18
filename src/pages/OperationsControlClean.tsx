import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
  const exceptions = useApi(useCallback(async () => api.operationsExceptions(date, await token()), [date, token]));
  const reconciliation = useApi(useCallback(async () => api.operationsReconciliation(date, await token()), [date, token]));

  const moving = (fleet.data?.vehicles || []).filter((vehicle) => vehicle.condition === "Moving");
  const movingWithTacho = moving.filter((vehicle) => Boolean(vehicle.tacho) || vehicle.driverSource === "TachoMaster").length;
  const movingWithoutTacho = Math.max(0, moving.length - movingWithTacho);

  const refresh = () => {
    void sage.refresh();
    void tacho.refresh();
    void road.refresh();
    void fleetio.refresh();
    void fleet.refresh();
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
        <small>Manual synchronisation is managed in Admin; this page is status and diagnostics only.</small>
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
          configured={tacho.data?.configured}
          connected={tacho.data?.connected}
          detail={tacho.data?.message || tacho.error || "Checking TachoMaster…"}
          meta={tacho.data ? `${tacho.data.matchedVehicleCount} current TachoMaster vehicle duty/card assignment${tacho.data.matchedVehicleCount === 1 ? "" : "s"}` : undefined}
        />
        <StatusCard
          title="DOT / RoadTech"
          configured={road.data?.configured}
          connected={road.data?.connected}
          detail={road.data?.message || road.error || "Checking DOT / RoadTech…"}
          meta={road.data ? `${road.data.recordCount} latest vehicle telemetry records returned` : undefined}
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
        <article><span>Vehicles moving now</span><strong>{moving.length}</strong><small>DOT/RoadTech live movement state</small></article>
        <article><span>Moving + Tacho matched</span><strong>{movingWithTacho}</strong><small>Moving vehicles with a current correlated Tacho driver/duty record</small></article>
        <article className={movingWithoutTacho ? "warning" : ""}><span>Moving without Tacho match</span><strong>{movingWithoutTacho}</strong><small>{movingWithoutTacho ? "Review card/duty identity coverage; movement itself is still confirmed by tracking." : "All moving vehicles have a current Tacho correlation."}</small></article>
      </div>
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
