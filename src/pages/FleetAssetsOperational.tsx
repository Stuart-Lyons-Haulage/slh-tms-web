import { useCallback, useState } from "react";
import { api, request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type FleetioAssetStatus = {
  configured: boolean;
  connected: boolean;
  retrievedAtUtc: string;
  vehicles: Array<{
    tmsVehicleId?: string;
    registration: string;
    fleetNumber?: string;
    fleetioId: string;
    fleetioName?: string;
    fleetioStatus?: string;
    pmiDueUtc?: string;
    motDueUtc?: string;
    serviceStatus?: string;
    matched: boolean;
  }>;
  trailers: Array<{
    tmsTrailerId?: string;
    trailerNumber: string;
    fleetioCNumber?: string;
    fleetioId: string;
    fleetioName?: string;
    fleetioStatus?: string;
    type?: string;
    pmiDueUtc?: string;
    motDueUtc?: string;
    serviceStatus?: string;
    matched: boolean;
  }>;
};

function date(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB");
}

function text(value?: string) {
  return value?.trim() || "—";
}

export function FleetAssetsOperational() {
  const token = useAccessToken();
  const status = useApi(useCallback(async () => request<FleetioAssetStatus>("/api/v1/integrations/fleetio/asset-status", await token()), [token]));
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string>();

  async function sync() {
    setSyncing(true);
    setMessage(undefined);
    try {
      const result = await request<{ message?: string; trailerDuplicatesMerged?: number }>("/api/v1/integrations/fleetio/sync-assets", await token(), { method: "POST" }, 60000);
      setMessage(result.message || "Fleetio asset sync completed.");
      await status.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fleetio sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">Fleetio master status</p>
          <h1>Vehicles & trailers</h1>
          <p className="hint">Fleetio Status is the operational source of truth. VOR is no longer shown as a separate field.</p>
        </div>
        <div className="title-actions">
          <button onClick={() => void status.refresh()} disabled={status.loading}>Refresh</button>
          <button className="primary" onClick={() => void sync()} disabled={syncing}>{syncing ? "Syncing Fleetio…" : "Sync Fleetio"}</button>
        </div>
      </div>
      {message && <p className="notice inline-notice">{message}</p>}
      {status.error ? <div className="state error"><p>{status.error}</p></div> : status.loading && !status.data ? <div className="state">Loading Fleetio assets…</div> : (
        <>
          <div className="panel">
            <p className="eyebrow">Powered fleet</p>
            <h2>Vehicles</h2>
            <div className="master-table-wrap" style={{ overflowX: "auto" }}>
              <table className="master-table" style={{ minWidth: 1150 }}>
                <thead><tr><th>Registration</th><th>Fleet no.</th><th>Fleetio name</th><th>Fleetio status</th><th>PMI / service due</th><th>MOT due</th><th>Maintenance</th><th>Match</th></tr></thead>
                <tbody>{(status.data?.vehicles || []).map((vehicle) => (
                  <tr key={vehicle.fleetioId}>
                    <td><strong>{vehicle.registration}</strong></td>
                    <td>{text(vehicle.fleetNumber)}</td>
                    <td>{text(vehicle.fleetioName)}</td>
                    <td><strong>{text(vehicle.fleetioStatus)}</strong></td>
                    <td>{date(vehicle.pmiDueUtc)}</td>
                    <td>{date(vehicle.motDueUtc)}</td>
                    <td>{text(vehicle.serviceStatus)}</td>
                    <td>{vehicle.matched ? "Matched" : "Needs matching"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <p className="eyebrow">Trailer fleet</p>
            <h2>Trailers</h2>
            <p className="hint">SLH number is the TMS identity. The C-number is the corresponding Fleetio asset identity.</p>
            <div className="master-table-wrap" style={{ overflowX: "auto" }}>
              <table className="master-table" style={{ minWidth: 1250 }}>
                <thead><tr><th>SLH trailer</th><th>Fleetio C-number</th><th>Type</th><th>Fleetio status</th><th>PMI / service due</th><th>MOT due</th><th>Maintenance</th><th>Match</th></tr></thead>
                <tbody>{(status.data?.trailers || []).map((trailer) => (
                  <tr key={trailer.fleetioId}>
                    <td><strong>{trailer.trailerNumber}</strong></td>
                    <td>{text(trailer.fleetioCNumber)}</td>
                    <td>{text(trailer.type)}</td>
                    <td><strong>{text(trailer.fleetioStatus)}</strong></td>
                    <td>{date(trailer.pmiDueUtc)}</td>
                    <td>{date(trailer.motDueUtc)}</td>
                    <td>{text(trailer.serviceStatus)}</td>
                    <td>{trailer.matched ? "Matched" : "Needs matching"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
