import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { api, type StageBatchRequest, type Vehicle } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

function text(value: unknown) { return String(value ?? "").trim(); }
function yes(value: unknown) { return /^(yes|y|true|1)$/i.test(text(value)); }
function maskCard(value?: string) {
  const clean = text(value);
  if (!clean) return "—";
  if (/\*/.test(clean)) return clean;
  const digits = clean.replace(/\s/g, "");
  return digits.length > 8 ? `${digits.slice(0, 6)}••••••${digits.slice(-4)}` : clean;
}

export function FuelCardsOperational() {
  const token = useAccessToken();
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Vehicle>();
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => (vehicles.data || []).filter((vehicle) => {
    const q = query.trim().toLowerCase();
    return !q || [vehicle.registration, vehicle.abbreviation, vehicle.cabMobile, vehicle.fuelPin, vehicle.shellCard, vehicle.bpRedCard, vehicle.bpPlainCard, vehicle.notes]
      .some((value) => text(value).toLowerCase().includes(q));
  }), [query, vehicles.data]);

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setMessage(`${label} copied.`);
  }

  function driverText(vehicle: Vehicle) {
    return `Vehicle ${vehicle.registration}${vehicle.abbreviation ? ` (${vehicle.abbreviation})` : ""} fuel PIN: ${vehicle.fuelPin || "PIN NOT SET"}`;
  }

  async function save() {
    if (!editing) return;
    setSaving(true); setMessage(undefined);
    try {
      const { id, ...payload } = editing;
      await api.updateVehicle(id, payload, await token());
      setEditing(undefined);
      await vehicles.refresh();
      setMessage("Fuel card details saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fuel card details could not be saved.");
    } finally { setSaving(false); }
  }

  async function importMaster(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true); setMessage(undefined);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheet = workbook.Sheets["Vehicles & Fuel"];
      if (!sheet) throw new Error("The workbook does not contain a 'Vehicles & Fuel' sheet.");
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const records: StageBatchRequest[] = data.flatMap((row) => {
        const registration = text(row["Registration"]).replace(/\s/g, "").toUpperCase();
        if (!registration) return [];
        return [{
          entityType: "vehicle",
          idempotencyKey: `fuel-master:${registration}`,
          source: `Fuel Cards master · ${file.name}`,
          payload: {
            registration,
            abbreviation: text(row["Abbreviation"]),
            transmission: text(row["Transmission"]),
            dvsCompliant: text(row["DVS"]) ? yes(row["DVS"]) : undefined,
            cabMobile: text(row["Cab Mobile"]),
            fuelPin: text(row["Fuel PIN"]),
            shellCard: text(row["Shell Card"]),
            bpRedCard: text(row["BP Red Card"]),
            bpPlainCard: text(row["BP Plain Card"]),
            notes: text(row["Notes"]),
            active: yes(row["Active"]),
          },
        }];
      });
      if (!records.length) throw new Error("No vehicle fuel records were found in the workbook.");
      const result = await api.applyMasterData(records, await token());
      await vehicles.refresh();
      setMessage(`${result.applied + result.registered} of ${records.length} fuel-card vehicle records accepted. ${result.failed ? `${result.failed} need review.` : "Fuel card register refreshed."}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The fuel-card master could not be imported.");
    } finally { setImporting(false); }
  }

  return <section>
    <div className="title-row">
      <div><p className="eyebrow">Fuel control</p><h1>Fuel cards & PINs</h1><p className="intro">One operational register showing which card and PIN belongs with each vehicle, ready to copy into the driver text.</p></div>
      <div className="title-actions"><button onClick={() => void vehicles.refresh()}>Refresh</button><label className="button-like">{importing ? "Importing…" : "Import latest master"}<input hidden type="file" accept=".xlsx,.xlsm,.xls" onChange={(event) => void importMaster(event)} disabled={importing} /></label></div>
    </div>
    {message && <p className="notice inline-notice">{message}</p>}
    {vehicles.error && <p className="notice inline-notice">{vehicles.error}</p>}
    <div className="planner-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search registration, PIN, card or notes…" /><span>{rows.length} active vehicle{rows.length === 1 ? "" : "s"}</span></div>
    <div className="master-table-wrap" style={{ overflowX: "auto" }}>
      <table className="master-table" style={{ minWidth: 1450 }}>
        <thead><tr><th>Vehicle</th><th>Cab mobile</th><th>Fuel PIN</th><th>Shell card</th><th>BP red card</th><th>BP plain card</th><th>Notes</th><th>Driver text</th><th>Edit</th></tr></thead>
        <tbody>{rows.map((vehicle) => <tr key={vehicle.id}>
          <td><strong>{vehicle.registration}</strong><br /><small>{vehicle.abbreviation || "—"}</small></td>
          <td>{vehicle.cabMobile || "—"}</td>
          <td><strong>{vehicle.fuelPin || "—"}</strong>{vehicle.fuelPin && <><br /><button onClick={() => void copy(vehicle.fuelPin!, `${vehicle.registration} PIN`)}>Copy PIN</button></>}</td>
          <td>{maskCard(vehicle.shellCard)}</td><td>{maskCard(vehicle.bpRedCard)}</td><td>{maskCard(vehicle.bpPlainCard)}</td><td>{vehicle.notes || "—"}</td>
          <td><button className="primary" onClick={() => void copy(driverText(vehicle), "Driver fuel text")}>Copy driver text</button></td>
          <td><button onClick={() => setEditing({ ...vehicle })}>Edit</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    {editing && <div className="panel" style={{ marginTop: 18 }}>
      <div className="title-row"><div><p className="eyebrow">Edit fuel record</p><h2>{editing.registration}</h2></div><button onClick={() => setEditing(undefined)}>Close</button></div>
      <div className="form-grid">
        <label>Cab mobile<input value={editing.cabMobile || ""} onChange={(e) => setEditing({ ...editing, cabMobile: e.target.value })} /></label>
        <label>Fuel PIN<input value={editing.fuelPin || ""} onChange={(e) => setEditing({ ...editing, fuelPin: e.target.value })} /></label>
        <label>Shell card<input value={editing.shellCard || ""} onChange={(e) => setEditing({ ...editing, shellCard: e.target.value })} /></label>
        <label>BP red card<input value={editing.bpRedCard || ""} onChange={(e) => setEditing({ ...editing, bpRedCard: e.target.value })} /></label>
        <label>BP plain card<input value={editing.bpPlainCard || ""} onChange={(e) => setEditing({ ...editing, bpPlainCard: e.target.value })} /></label>
        <label className="wide">Notes<input value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label>
      </div>
      <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save fuel record"}</button>
    </div>}
  </section>;
}