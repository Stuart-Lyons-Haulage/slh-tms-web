import { useCallback } from "react";
import { OperationsControl } from "./Pages";
import { api } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

function StatusCard({ title, configured, connected, detail, meta }: { title: string; configured?: boolean; connected?: boolean; detail: string; meta?: string }) {
  return <article className="admin-card">
    <span className={connected ? "integration-state ready" : configured ? "integration-state pending" : "integration-state pending"}>
      {connected ? "Live" : configured ? "Configured" : "Setup needed"}
    </span>
    <h2>{title}</h2>
    <p>{detail}</p>
    {meta && <small>{meta}</small>}
  </article>;
}

export function OperationsControlClean() {
  const token = useAccessToken();
  const sage = useApi(useCallback(async () => api.sageHrStatus(await token()), [token]));
  const tacho = useApi(useCallback(async () => api.tachoMasterStatus(await token()), [token]));
  const road = useApi(useCallback(async () => api.roadTechStatus(await token()), [token]));
  const fleetio = useApi(useCallback(async () => api.fleetioStatus(await token()), [token]));

  return <div className="ops-control-clean">
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row">
        <div><p className="eyebrow">Live integration check</p><h2>Provider status</h2></div>
        <button onClick={() => { void sage.refresh(); void tacho.refresh(); void road.refresh(); void fleetio.refresh(); }}>Refresh live checks</button>
      </div>
      <div className="admin-grid">
        <StatusCard
          title="Sage HR"
          configured={sage.data?.configured}
          connected={sage.data?.connected}
          detail={sage.data?.message || sage.error || "Checking Sage HR…"}
          meta={sage.data ? `${sage.data.employeeCount} employees · ${sage.data.driverCandidateCount} driver candidates` : undefined}
        />
        <StatusCard
          title="TachoMaster"
          configured={tacho.data?.configured}
          connected={tacho.data?.connected}
          detail={tacho.data?.message || tacho.error || "Checking TachoMaster…"}
          meta={tacho.data ? `${tacho.data.matchedVehicleCount} current vehicle/driver assignments` : undefined}
        />
        <StatusCard
          title="DOT / RoadTech"
          configured={road.data?.configured}
          connected={road.data?.connected}
          detail={road.data?.message || road.error || "Checking DOT / RoadTech…"}
          meta={road.data ? `${road.data.recordCount} live vehicle records` : undefined}
        />
        <StatusCard
          title="Fleetio"
          configured={fleetio.data?.configured}
          connected={fleetio.data?.connected}
          detail={fleetio.data?.message || fleetio.error || "Checking Fleetio…"}
          meta={fleetio.data ? `${fleetio.data.sampleVehicleCount} sampled vehicle records` : undefined}
        />
      </div>
    </section>
    <style>{`.ops-control-clean > section + section .admin-grid > .admin-card:first-child > small:first-of-type{display:none}`}</style>
    <OperationsControl />
  </div>;
}
