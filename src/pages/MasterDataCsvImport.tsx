/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState, type ChangeEvent } from "react";
import { api, type StageBatchRequest } from "../lib/api";
import { useAccessToken } from "../lib/auth";

type MasterEntity = "driver" | "vehicle" | "trailer" | "site";
type FlatPayload = Record<string, string | number | boolean>;

type ParsedMasterCsv = {
  requests: StageBatchRequest[];
  headers: string[];
  preview: FlatPayload[];
  warnings: string[];
};

const identityFields: Record<MasterEntity, string[]> = {
  driver: ["employeeNumber", "displayName"],
  vehicle: ["registration"],
  trailer: ["trailerNumber"],
  site: ["externalCode", "name"],
};

const aliases: Record<string, string> = {
  employeenumber: "employeeNumber", drivernumber: "employeeNumber", driverno: "employeeNumber", payrollnumber: "employeeNumber", payrollno: "employeeNumber",
  displayname: "displayName", drivername: "displayName", name: "name",
  drivinglicencenumber: "drivingLicenceNumber", licencenumber: "drivingLicenceNumber", licensenumber: "drivingLicenceNumber",
  licenceexpiry: "licenceExpiry", licenseexpiry: "licenceExpiry", tachoname: "tachoName", mobilenumber: "mobileNumber", mobile: "mobileNumber",
  registration: "registration", reg: "registration", fleetnumber: "fleetNumber", fleetno: "fleetNumber", abbreviation: "abbreviation",
  trailernumber: "trailerNumber", trailerno: "trailerNumber", standardcapacity: "standardCapacity", eurocapacity: "euroCapacity", type: "type",
  externalcode: "externalCode", sitecode: "externalCode", sitename: "name", drivertextname: "driverTextName", collectionaddress: "collectionAddress", aliases: "aliases",
  active: "active",
};

function key(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fieldName(value: string) {
  const compact = key(value);
  return aliases[compact] || value.trim().replace(/^./, (character) => character.toLowerCase()).replace(/\s+(.)/g, (_, character: string) => character.toUpperCase());
}

export function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(value.trim()); value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normaliseDate(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : value;
}

function typedValue(field: string, raw: string): string | number | boolean {
  if (field === "active") return !["false", "no", "0", "inactive"].includes(raw.trim().toLowerCase());
  if (["standardCapacity", "euroCapacity"].includes(field) && /^-?\d+$/.test(raw.trim())) return Number(raw);
  if (field.toLowerCase().includes("expiry") || field.toLowerCase().endsWith("date")) return normaliseDate(raw.trim());
  return raw.trim();
}

export function parseMasterDataCsv(text: string, entity: MasterEntity, fileName: string): ParsedMasterCsv {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
  const headers = rows[0].map(fieldName);
  const warnings: string[] = [];
  const preview: FlatPayload[] = [];
  const requests: StageBatchRequest[] = [];

  rows.slice(1).forEach((cells, index) => {
    const payload: FlatPayload = {};
    headers.forEach((header, column) => {
      const raw = cells[column] ?? "";
      if (raw !== "") payload[header] = typedValue(header, raw);
    });
    const identity = identityFields[entity].map((field) => payload[field]).find((value) => value != null && String(value).trim());
    if (!identity) {
      warnings.push(`Row ${index + 2} was skipped because it has no ${identityFields[entity].join(" / ")} identity.`);
      return;
    }
    preview.push(payload);
    requests.push({
      entityType: entity,
      idempotencyKey: `csv-sanity:${entity}:${String(identity).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-")}`,
      source: `Master data CSV sanity · ${fileName}`,
      payload,
    });
  });

  if (!requests.length) throw new Error("No importable master-data rows were found in the CSV.");
  return { requests, headers, preview: preview.slice(0, 6), warnings };
}

export function MasterDataCsvImport() {
  const token = useAccessToken();
  const [entity, setEntity] = useState<MasterEntity>("driver");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedMasterCsv>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const previewHeaders = useMemo(() => parsed ? Array.from(new Set(parsed.preview.flatMap((row) => Object.keys(row)))).slice(0, 8) : [], [parsed]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setParsed(undefined); setMessage(undefined); setError(undefined);
    if (!file) return;
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("Choose a .csv file."); return; }
    try {
      const result = parseMasterDataCsv(await file.text(), entity, file.name);
      setParsed(result);
      setMessage(`${result.requests.length} ${entity} row${result.requests.length === 1 ? "" : "s"} ready for review.`);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The CSV could not be read.");
    }
  }

  async function apply() {
    if (!parsed?.requests.length) return;
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const result = await api.applyMasterData(parsed.requests, await token());
      setMessage(`${result.applied} applied${result.failed ? ` · ${result.failed} failed` : ""}.`);
      if (result.failed) {
        const failures = result.results.filter((item) => !item.applied).map((item) => item.error).filter(Boolean).slice(0, 5);
        if (failures.length) setError(failures.join(" · "));
      }
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The master-data CSV could not be applied.");
    } finally { setSaving(false); }
  }

  return <section className="panel master-csv-import">
    <div className="title-row">
      <div>
        <p className="eyebrow">Contingency sanity check</p>
        <h2>Master data CSV</h2>
        <p className="hint">Use this only when you need to reconcile a simple CSV against live TMS master data — for example driver numbers, licence details, vehicles, trailers or site codes. Review the preview before applying.</p>
      </div>
    </div>
    <div className="master-csv-controls">
      <label>Master type<select value={entity} onChange={(event) => { setEntity(event.target.value as MasterEntity); setParsed(undefined); setFileName(""); setMessage(undefined); setError(undefined); }}>
        <option value="driver">Drivers / licences</option><option value="vehicle">Vehicles</option><option value="trailer">Trailers</option><option value="site">Sites</option>
      </select></label>
      <label>CSV file<input type="file" accept="text/csv,.csv" onChange={(event) => void chooseFile(event)} /></label>
      {fileName && <strong>{fileName}</strong>}
    </div>
    {message && <p className="notice ready">{message}</p>}
    {error && <p className="notice">{error}</p>}
    {parsed?.warnings.length ? <p className="notice inline-notice">{parsed.warnings.slice(0, 5).join(" · ")}</p> : null}
    {parsed?.preview.length ? <div className="master-csv-preview"><table className="master-table"><thead><tr>{previewHeaders.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{parsed.preview.map((row, index) => <tr key={index}>{previewHeaders.map((header) => <td key={header}>{String(row[header] ?? "")}</td>)}</tr>)}</tbody></table></div> : null}
    <div className="actions"><button type="button" className="primary" disabled={!parsed?.requests.length || saving} onClick={() => void apply()}>{saving ? "Applying…" : `Apply ${parsed?.requests.length || ""} reviewed rows`}</button></div>
  </section>;
}
