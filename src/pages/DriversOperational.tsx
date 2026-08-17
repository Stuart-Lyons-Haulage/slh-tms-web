import { useCallback, useMemo, useState, type ChangeEvent } from "react";
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

function normaliseName(input: unknown) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sortedName(input: unknown) {
  return normaliseName(input).split(" ").filter(Boolean).sort().join(" ");
}

type TachoCsvDriver = {
  surname: string;
  givenNames: string;
  tachoName: string;
  siteName?: string;
  lastRead?: string;
};

type TachoMatch = {
  source: TachoCsvDriver;
  driver: Driver;
  confidence: "Exact" | "Strong";
};

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseTachoAvailabilityCsv(text: string): TachoCsvDriver[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const indexOf = (name: string) => headers.indexOf(name);
  const surnameIndex = indexOf("s_name");
  const givenIndex = indexOf("c_name");
  if (surnameIndex < 0 || givenIndex < 0)
    throw new Error("This does not look like a TachoMaster Driver Availability CSV. Expected s_name and c_name columns.");
  const siteIndex = indexOf("site_name");
  const readIndex = indexOf("tacho_card_last_read_csv");
  return lines.slice(1).flatMap((line) => {
    const cells = parseCsvLine(line);
    const surname = (cells[surnameIndex] || "").trim();
    const givenNames = (cells[givenIndex] || "").trim();
    if (!surname || !givenNames) return [];
    return [{
      surname,
      givenNames,
      tachoName: `${givenNames} ${surname}`.replace(/\s+/g, " ").trim(),
      siteName: siteIndex >= 0 ? cells[siteIndex] : undefined,
      lastRead: readIndex >= 0 ? cells[readIndex] : undefined,
    }];
  });
}

function matchTachoDriver(source: TachoCsvDriver, drivers: Driver[]): TachoMatch | undefined {
  const sourceSorted = sortedName(source.tachoName);
  const exact = drivers.filter((driver) =>
    [driver.tachoName, driver.displayName].some((name) => sortedName(name) === sourceSorted),
  );
  if (exact.length === 1) return { source, driver: exact[0], confidence: "Exact" };

  const sourceSurname = normaliseName(source.surname);
  const sourceFirst = normaliseName(source.givenNames).split(" ")[0] || "";
  const strong = drivers.filter((driver) => {
    const candidates = [driver.tachoName, driver.displayName].filter(Boolean).map(normaliseName);
    return candidates.some((candidate) => {
      const parts = candidate.split(" ").filter(Boolean);
      const surnamePresent = parts.includes(sourceSurname);
      const givenMatch = parts.some((part) =>
        part.length >= 4 && sourceFirst.length >= 4 &&
        (part.startsWith(sourceFirst) || sourceFirst.startsWith(part)),
      );
      return surnamePresent && givenMatch;
    });
  });
  return strong.length === 1 ? { source, driver: strong[0], confidence: "Strong" } : undefined;
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
  const [importing, setImporting] = useState(false);
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

  async function importTachoCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !drivers.data?.length) return;
    setImporting(true);
    setMessage(undefined);
    try {
      const sourceRows = parseTachoAvailabilityCsv(await file.text());
      const matches = sourceRows.flatMap((source) => {
        const match = matchTachoDriver(source, drivers.data || []);
        return match ? [match] : [];
      });
      const uniqueDrivers = new Map(matches.map((match) => [match.driver.id, match]));
      const accessToken = await token();
      let updated = 0;
      for (const match of uniqueDrivers.values()) {
        if (normaliseName(match.driver.tachoName) === normaliseName(match.source.tachoName)) continue;
        const { id, lastTachoSyncUtc: _lastSync, ...payload } = match.driver;
        void _lastSync;
        await api.updateDriver(id, { ...payload, tachoName: match.source.tachoName }, accessToken);
        updated += 1;
      }
      const exactCount = matches.filter((match) => match.confidence === "Exact").length;
      const strongCount = matches.filter((match) => match.confidence === "Strong").length;
      const unmatched = Math.max(sourceRows.length - matches.length, 0);
      setMessage(
        `TachoMaster file read: ${sourceRows.length} drivers. ${matches.length} confidently matched (${exactCount} exact, ${strongCount} strong), ${updated} Tacho names updated, ${unmatched} left unchanged for manual review. No new driver records were created.`,
      );
      await drivers.refresh();
      await api.syncTachoMasterDrivers(accessToken).catch(() => undefined);
      await drivers.refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "TachoMaster CSV import failed.");
    } finally {
      setImporting(false);
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
          <label className={`button-like ${importing ? "disabled" : ""}`}>
            {importing ? "Importing Tacho CSV…" : "Import TachoMaster CSV"}
            <input type="file" accept=".csv,text/csv" hidden disabled={importing} onChange={(event) => void importTachoCsv(event)} />
          </label>
          <button onClick={() => void drivers.refresh()} disabled={drivers.loading}>Refresh</button>
          <button className="primary" onClick={() => void syncTacho()} disabled={syncing}>
            {syncing ? "Syncing TachoMaster…" : "Sync TachoMaster"}
          </button>
        </div>
      </div>
      <p className="hint">TachoMaster Driver Availability CSVs update only existing driver Tacho names when the identity match is confident. Unmatched rows are left untouched to prevent duplicate or incorrect drivers.</p>
      {message && <p className="notice inline-notice">{message}</p>}
      {drivers.error ? <div className="state error"><p>{drivers.error}</p></div> : drivers.loading && !drivers.data ? <div className="state">Loading driver and Tacho data…</div> : <DriverTachoOverview rows={drivers.data || []} />}
      <div className="driver-maintenance-section">
        <p className="eyebrow">Driver maintenance</p>
        <DriversMaster />
      </div>
    </div>
  );
}
