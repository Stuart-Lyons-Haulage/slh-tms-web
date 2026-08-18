import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { Link } from "react-router-dom";
import { api, type Vehicle } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type MigrationRow = {
  registration: string;
  sourceSheet: string;
  sourceRow: number;
  vehicle?: Vehicle;
  updates: Partial<Vehicle>;
};

const aliases: Record<keyof Pick<Vehicle, "cabMobile" | "fuelProvider" | "fuelPin" | "shellCard" | "bpRedCard" | "bpPlainCard" | "notes">, string[]> = {
  cabMobile: ["cab mobile", "cab phone", "cab telephone", "phone", "mobile", "cab no", "cab number"],
  fuelProvider: ["fuel provider", "provider", "fuel company"],
  fuelPin: ["fuel pin", "pin", "fuelcard pin", "fuel card pin"],
  shellCard: ["shell card", "shell", "shell card number", "shell fuel card"],
  bpRedCard: ["bp red card", "bp red", "red card", "bp red card number"],
  bpPlainCard: ["bp plain card", "bp plain", "plain card", "bp card", "bp card number"],
  notes: ["notes", "note", "comments", "comment"],
};
const registrationAliases = ["registration", "reg", "vehicle registration", "vehicle reg", "vehicle", "vrm"];

function normaliseHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_\-/]+/g, " ");
}
function normaliseRegistration(value: unknown) {
  return String(value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}
function text(value: unknown) { return String(value ?? "").trim(); }
function findColumn(headers: unknown[], names: string[]) {
  const wanted = names.map(normaliseHeader);
  return headers.findIndex((header) => wanted.includes(normaliseHeader(header)));
}
function changedFields(row: MigrationRow) {
  if (!row.vehicle) return Object.keys(row.updates);
  return Object.entries(row.updates)
    .filter(([key, value]) => String(row.vehicle?.[key as keyof Vehicle] ?? "") !== String(value ?? ""))
    .map(([key]) => key);
}

export function FuelCardMigration() {
  const token = useAccessToken();
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<MigrationRow[]>([]);
  const [message, setMessage] = useState<string>();
  const [applying, setApplying] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const summary = useMemo(() => ({
    matched: rows.filter((row) => row.vehicle).length,
    unmatched: rows.filter((row) => !row.vehicle).length,
    changed: rows.filter((row) => row.vehicle && changedFields(row).length > 0).length,
  }), [rows]);

  async function readWorkbook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage(undefined);
    setRows([]);
    setConfirmed(false);
    setFileName(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const vehicleMap = new Map((vehicles.data || []).map((vehicle) => [normaliseRegistration(vehicle.registration), vehicle]));
      const preferred = ["fuel cards", "fuel card", "vehicles & fuel", "master data"];
      const sheetNames = [...workbook.SheetNames].sort((a, b) => {
        const ai = preferred.indexOf(normaliseHeader(a));
        const bi = preferred.indexOf(normaliseHeader(b));
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
      const parsed: MigrationRow[] = [];
      for (const sheetName of sheetNames) {
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "" });
        const headerRowIndex = matrix.slice(0, 25).findIndex((candidate) => findColumn(candidate, registrationAliases) >= 0);
        if (headerRowIndex < 0) continue;
        const headers = matrix[headerRowIndex];
        const regColumn = findColumn(headers, registrationAliases);
        const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, findColumn(headers, names)]));
        for (let index = headerRowIndex + 1; index < matrix.length; index++) {
          const source = matrix[index];
          const registration = normaliseRegistration(source[regColumn]);
          if (!registration) continue;
          const updates: Partial<Vehicle> = {};
          for (const [key, column] of Object.entries(columns)) {
            if (Number(column) < 0) continue;
            const value = text(source[Number(column)]);
            if (value) (updates as Record<string, unknown>)[key] = value;
          }
          if (!Object.keys(updates).length) continue;
          parsed.push({ registration, sourceSheet: sheetName, sourceRow: index + 1, vehicle: vehicleMap.get(registration), updates });
        }
        if (parsed.length) break;
      }
      if (!parsed.length) throw new Error("No fuel-card records were found. The workbook needs a vehicle registration column plus at least one fuel-card, PIN, provider, cab phone or notes column.");
      setRows(parsed);
      const matched = parsed.filter((row) => row.vehicle).length;
      setMessage(`${parsed.length} fuel records found in ${file.name}. ${matched} matched to vehicles in the TMS.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The workbook could not be read.");
    }
  }

  async function applyMigration() {
    const candidates = rows.filter((row) => row.vehicle && changedFields(row).length > 0);
    if (!confirmed || !candidates.length) return;
    setApplying(true);
    setMessage(undefined);
    let updated = 0;
    const failures: string[] = [];
    try {
      const accessToken = await token();
      for (const row of candidates) {
        try {
          const vehicle = row.vehicle!;
          const payload = { ...vehicle, ...row.updates };
          const { id, ...update } = payload;
          await api.updateVehicle(id, update, accessToken);
          updated++;
        } catch (error) {
          failures.push(`${row.registration}: ${error instanceof Error ? error.message : "update failed"}`);
        }
      }
      await vehicles.refresh();
      setMessage(`${updated} vehicle fuel record${updated === 1 ? "" : "s"} updated in the Live TMS Master Database.${failures.length ? ` ${failures.length} failed and remain unchanged.` : ""}`);
      setRows((current) => current.filter((row) => !row.vehicle || failures.some((failure) => failure.startsWith(row.registration))));
      setConfirmed(false);
    } finally {
      setApplying(false);
    }
  }

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Admin · legacy migration</p>
        <h1>Fuel card migration</h1>
        <p className="intro">Use this only to bring the existing fuel register into the TMS. Once migrated, maintain fuel cards and PINs in the live Fuel Cards register.</p>
      </div>
      <div className="title-actions"><Link className="button-like" to="/fuel-cards">Back to fuel register</Link></div>
    </div>

    <div className="panel">
      <h2>1. Select legacy workbook</h2>
      <p>The importer checks Fuel Cards, Vehicles & Fuel and Master Data style sheets, then detects common registration, cab phone, PIN and card-number headings.</p>
      <label className="button-like">Choose Excel workbook<input hidden type="file" accept=".xlsx,.xlsm,.xls" onChange={(event) => void readWorkbook(event)} /></label>
      {fileName && <p className="hint">Selected: {fileName}</p>}
      {message && <p className="notice inline-notice">{message}</p>}
    </div>

    {rows.length > 0 && <>
      <div className="metrics" style={{ marginTop: 18 }}>
        <article><span>Matched</span><strong>{summary.matched}</strong></article>
        <article><span>Changes ready</span><strong>{summary.changed}</strong></article>
        <article><span>Unmatched</span><strong>{summary.unmatched}</strong></article>
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <div className="title-row"><div><p className="eyebrow">2. Preview</p><h2>Vehicle matches and proposed changes</h2></div></div>
        <div className="master-table-wrap" style={{ overflowX: "auto" }}>
          <table className="master-table" style={{ minWidth: 1200 }}>
            <thead><tr><th>Registration</th><th>Match</th><th>Source</th><th>Changes</th><th>Cab mobile</th><th>Fuel PIN</th><th>Shell</th><th>BP red</th><th>BP plain</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={`${row.registration}-${index}`}>
              <td><strong>{row.registration}</strong></td>
              <td><span className={`status ${row.vehicle ? "approved" : "rejected"}`}>{row.vehicle ? "Matched" : "Not in TMS"}</span></td>
              <td>{row.sourceSheet} · row {row.sourceRow}</td>
              <td>{row.vehicle ? changedFields(row).join(", ") || "No change" : "Review vehicle registration"}</td>
              <td>{row.updates.cabMobile || "—"}</td><td>{row.updates.fuelPin || "—"}</td><td>{row.updates.shellCard || "—"}</td><td>{row.updates.bpRedCard || "—"}</td><td>{row.updates.bpPlainCard || "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <p className="eyebrow">3. Apply migration</p>
        <h2>Write matched changes to the TMS</h2>
        <p>Only matched vehicles with actual changes will be updated. Unmatched rows are never created automatically.</p>
        <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I have reviewed the preview and want to update the live TMS master.</label>
        <div style={{ marginTop: 12 }}><button className="primary" disabled={!confirmed || !summary.changed || applying} onClick={() => void applyMigration()}>{applying ? "Applying…" : `Apply ${summary.changed} matched change${summary.changed === 1 ? "" : "s"}`}</button></div>
      </div>
    </>}
  </section>;
}
