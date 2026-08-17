import { useCallback, useMemo, useState } from "react";
import { api, type Driver } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { DriversMaster } from "./Pages";

function value(value: unknown) {
  return value == null || value === "" ? "—" : String(value);
}

function minutes(value?: number) {
  if (value == null) return "—";
  const hours = Math.floor(value / 60);
  const mins = Math.abs(value % 60);
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

function dateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-GB");
}

function DriverTachoOverview({ rows }: { rows: Driver[] }) {
  const [filter, setFilter] = useState("");
  const normalised = filter.trim().toLowerCase();
  const visible = useMemo(
    () => rows.filter((row) => !normalised || [row.displayName, row.employeeNumber, row.tachoName, row.tachoCardNumber, row.mobileNumber].some((field) => String(field || "").toLowerCase().includes(normalised))),
    [rows, normalised],
  );

  return (
    <section className="driver-tacho-overview">
      <div className="title-row">
        <div>
          <p className="eyebrow">Operational driver register</p>
          <h1>Drivers & TachoMaster</h1>
        </div>
        <label className="master-filter">
          Search driver / employee / Tacho
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search…" />
        </label>
      </div>
      <p className="intro">
        Live planning view of driver identity, TachoMaster linkage and available driving/work time. Driver maintenance and imports remain below this table.
      </p>
      <div className="master-table-wrap">
        <table className="master-table driver-tacho-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Driver</th>
              <th>Mobile</th>
              <th>Type</th>
              <th>Group</th>
              <th>Agency</th>
              <th>Tacho name</th>
              <th>Tacho card</th>
              <th>Tacho link</th>
              <th>Drive left today</th>
              <th>Drive left week</th>
              <th>Work left week</th>
              <th>Last Tacho sync</th>
              <th>Licence</th>
              <th>Licence expiry</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td>{value(row.employeeNumber)}</td>
                <td><strong>{value(row.displayName)}</strong></td>
                <td>{value(row.mobileNumber)}</td>
                <td>{value(row.driverType || (row.agencyName ? "Agency" : ""))}</td>
                <td>{value(row.driverGroup)}</td>
                <td>{value(row.agencyName)}</td>
                <td>{value(row.tachoName)}</td>
                <td>{value(row.tachoCardNumber)}</td>
                <td>{row.tachoMasterDriverId ? "Linked" : "Not linked"}</td>
                <td>{minutes(row.tachoDriveAvailableTodayMinutes)}</td>
                <td>{minutes(row.tachoDriveAvailableWeekMinutes)}</td>
                <td>{minutes(row.tachoWorkAvailableWeekMinutes)}</td>
                <td>{dateTime(row.lastTachoSyncUtc)}</td>
                <td>{value(row.licenceStatus)}</td>
                <td>{value(row.licenceExpiry)}</td>
                <td>{row.active ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{visible.length} of {rows.length} drivers shown.</p>
    </section>
  );
}

export function DriversOperational() {
  const token = useAccessToken();
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string>();

  async function syncTacho() {
    setSyncing(true);
    setMessage(undefined);
    try {
      const result = await api.syncTachoMasterDrivers(await token());
      setMessage(result.message || `${result.matched} drivers matched to TachoMaster.`);
      await drivers.refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "TachoMaster sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="drivers-operational-page">
      <div className="title-row driver-sync-actions">
        <div>
          <p className="eyebrow">Driver availability</p>
          <h1>Driver control</h1>
        </div>
        <div className="title-actions">
          <button onClick={() => void drivers.refresh()} disabled={drivers.loading}>Refresh</button>
          <button className="primary" onClick={() => void syncTacho()} disabled={syncing}>
            {syncing ? "Syncing TachoMaster…" : "Sync TachoMaster"}
          </button>
        </div>
      </div>
      {message && <p className="notice inline-notice">{message}</p>}
      {drivers.error ? <div className="state error"><p>{drivers.error}</p></div> : drivers.loading && !drivers.data ? <div className="state">Loading driver and Tacho data…</div> : <DriverTachoOverview rows={drivers.data || []} />}
      <div className="driver-maintenance-section">
        <p className="eyebrow">Driver maintenance</p>
        <DriversMaster />
      </div>
    </div>
  );
}
