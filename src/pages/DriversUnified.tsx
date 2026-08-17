import { useCallback, useMemo, useState } from "react";
import { api, type Driver } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

function value(input: unknown) {
  return input == null || input === "" ? "—" : String(input);
}

function minutes(input?: number) {
  if (input == null) return "—";
  return `${Math.floor(input / 60)}h ${String(Math.abs(input % 60)).padStart(2, "0")}m`;
}

function dateTime(input?: string) {
  if (!input) return "—";
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input : parsed.toLocaleString("en-GB");
}

export function DriversUnified() {
  const token = useAccessToken();
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<Driver>();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string>();

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (drivers.data || []).filter((driver) =>
      !q || [driver.employeeNumber, driver.displayName, driver.mobileNumber, driver.driverType, driver.driverGroup, driver.tachoName, driver.tachoCardNumber, driver.drivingLicenceNumber]
        .some((item) => String(item || "").toLowerCase().includes(q)),
    );
  }, [drivers.data, filter]);

  function startEdit(driver: Driver) {
    setEditingId(driver.id);
    setDraft({ ...driver });
    setMessage(undefined);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const { id, lastTachoSyncUtc: _lastSync, agencyName: _agency, ...payload } = draft;
      void _lastSync;
      void _agency;
      await api.updateDriver(id, payload, await token());
      setEditingId(undefined);
      setDraft(undefined);
      setMessage(`${draft.displayName} updated.`);
      await drivers.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Driver update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function syncTacho() {
    setSyncing(true);
    setMessage(undefined);
    try {
      const result = await api.syncTachoMasterDrivers(await token());
      setMessage(result.message || `${result.matched} drivers matched to TachoMaster.`);
      await drivers.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TachoMaster sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const edit = <K extends keyof Driver>(key: K, value: Driver[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);

  return (
    <section className="drivers-unified-page">
      <div className="title-row">
        <div>
          <p className="eyebrow">Master data + live TachoMaster</p>
          <h1>Drivers</h1>
          <p className="hint">One driver, one row. Scroll horizontally for all driver, licence and Tacho information.</p>
        </div>
        <div className="title-actions">
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search driver…" />
          <button onClick={() => void drivers.refresh()} disabled={drivers.loading}>Refresh</button>
          <button className="primary" onClick={() => void syncTacho()} disabled={syncing}>{syncing ? "Syncing…" : "Sync TachoMaster"}</button>
        </div>
      </div>
      {message && <p className="notice inline-notice">{message}</p>}
      {drivers.error ? <div className="state error"><p>{drivers.error}</p></div> : (
        <div className="master-table-wrap" style={{ overflowX: "auto" }}>
          <table className="master-table driver-unified-table" style={{ minWidth: 2300 }}>
            <thead>
              <tr>
                <th>Employee</th><th>Driver</th><th>Mobile</th><th>Type</th><th>Group</th><th>Skills</th><th>Coding</th>
                <th>North</th><th>Preload</th><th>Tacho name</th><th>Tacho card</th><th>Tacho member</th>
                <th>Drive left today</th><th>Drive left week</th><th>Work left week</th><th>Last Tacho sync</th>
                <th>Licence no.</th><th>Licence expiry</th><th>Licence status</th><th>Notes</th><th>Active</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((driver) => {
                const isEditing = editingId === driver.id && draft;
                const row = isEditing ? draft : driver;
                return (
                  <tr key={driver.id}>
                    <td>{isEditing ? <input value={row.employeeNumber} onChange={(e) => edit("employeeNumber", e.target.value)} /> : value(row.employeeNumber)}</td>
                    <td>{isEditing ? <input value={row.displayName} onChange={(e) => edit("displayName", e.target.value)} /> : <strong>{value(row.displayName)}</strong>}</td>
                    <td>{isEditing ? <input value={row.mobileNumber || ""} onChange={(e) => edit("mobileNumber", e.target.value)} /> : value(row.mobileNumber)}</td>
                    <td>{isEditing ? <input value={row.driverType || ""} onChange={(e) => edit("driverType", e.target.value)} /> : value(row.driverType)}</td>
                    <td>{isEditing ? <input value={row.driverGroup || ""} onChange={(e) => edit("driverGroup", e.target.value)} /> : value(row.driverGroup)}</td>
                    <td>{isEditing ? <input value={row.skills || ""} onChange={(e) => edit("skills", e.target.value)} /> : value(row.skills)}</td>
                    <td>{isEditing ? <input value={row.coding || ""} onChange={(e) => edit("coding", e.target.value)} /> : value(row.coding)}</td>
                    <td>{isEditing ? <input type="checkbox" checked={Boolean(row.northEligible)} onChange={(e) => edit("northEligible", e.target.checked)} /> : row.northEligible ? "Yes" : "No"}</td>
                    <td>{isEditing ? <input type="checkbox" checked={Boolean(row.preloadEligible)} onChange={(e) => edit("preloadEligible", e.target.checked)} /> : row.preloadEligible ? "Yes" : "No"}</td>
                    <td>{isEditing ? <input value={row.tachoName || ""} onChange={(e) => edit("tachoName", e.target.value)} /> : value(row.tachoName)}</td>
                    <td>{value(row.tachoCardNumber)}</td>
                    <td>{value(row.tachoMasterDriverId)}</td>
                    <td>{minutes(row.tachoDriveAvailableTodayMinutes)}</td>
                    <td>{minutes(row.tachoDriveAvailableWeekMinutes)}</td>
                    <td>{minutes(row.tachoWorkAvailableWeekMinutes)}</td>
                    <td>{dateTime(row.lastTachoSyncUtc)}</td>
                    <td>{isEditing ? <input value={row.drivingLicenceNumber || ""} onChange={(e) => edit("drivingLicenceNumber", e.target.value)} /> : value(row.drivingLicenceNumber)}</td>
                    <td>{isEditing ? <input type="date" value={row.licenceExpiry || ""} onChange={(e) => edit("licenceExpiry", e.target.value)} /> : value(row.licenceExpiry)}</td>
                    <td>{isEditing ? <input value={row.licenceStatus || ""} onChange={(e) => edit("licenceStatus", e.target.value)} /> : value(row.licenceStatus)}</td>
                    <td>{isEditing ? <input value={row.notes || ""} onChange={(e) => edit("notes", e.target.value)} /> : value(row.notes)}</td>
                    <td>{isEditing ? <input type="checkbox" checked={row.active} onChange={(e) => edit("active", e.target.checked)} /> : row.active ? "Yes" : "No"}</td>
                    <td>
                      {isEditing ? <div className="actions"><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button><button onClick={() => { setEditingId(undefined); setDraft(undefined); }}>Cancel</button></div> : <button onClick={() => startEdit(driver)}>Edit</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">{visible.length} driver{visible.length === 1 ? "" : "s"} shown. Agency has been removed from the operational driver register.</p>
    </section>
  );
}
