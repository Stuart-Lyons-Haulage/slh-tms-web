/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState, type ChangeEvent } from "react";
import { request, type MasterApplyResponse, type StageBatchRequest } from "../lib/api";
import { useAccessToken } from "../lib/auth";

type MasterEntity = "driver" | "vehicle" | "trailer" | "site" | "marketcontact" | "sitetimingrule";
type FlatPayload = Record<string, string | number | boolean>;
type DiffStatus = "UNCHANGED" | "NEW" | "UPDATE" | "CRITICAL REVIEW";
type DiffRow = { request: StageBatchRequest; current?: FlatPayload; status: DiffStatus; differences: string[]; selected: boolean };
type ParsedMasterCsv = { requests: StageBatchRequest[]; headers: string[]; preview: FlatPayload[]; warnings: string[] };

const MASTER_IMPORT_CHUNK_SIZE = 25;
const identityFields: Record<MasterEntity, string[]> = {
  driver: ["employeeNumber", "displayName"], vehicle: ["registration"], trailer: ["trailerNumber"], site: ["externalCode", "name"],
  marketcontact: ["market", "name"], sitetimingrule: ["routeCombination"],
};
const protectedFields: Record<MasterEntity, string[]> = {
  driver: ["employeeNumber", "tachoName", "tachoMasterDriverId", "tachoCardNumber", "mobileNumber", "drivingLicenceNumber", "licenceExpiry", "active"],
  vehicle: ["registration", "fuelProvider", "fuelPin", "shellCard", "bpRedCard", "bpPlainCard", "fuelPinSecretName", "fuelCardLastFour", "active"],
  trailer: ["trailerNumber", "standardCapacity", "euroCapacity", "type", "active"],
  site: ["externalCode", "collectionAddress", "collectionInstructions", "aliases", "latitude", "longitude", "active"],
  marketcontact: ["market", "name", "standOrLocation", "salesman", "sender", "active"],
  sitetimingrule: ["routeCombination", "palletType", "lastDespatch", "collectFrom", "collectTo", "depotDeadline"],
};
const aliases: Record<string, string> = {
  employeenumber: "employeeNumber", drivernumber: "employeeNumber", driverno: "employeeNumber", payrollnumber: "employeeNumber", payrollno: "employeeNumber",
  displayname: "displayName", drivername: "displayName", drivinglicencenumber: "drivingLicenceNumber", licencenumber: "drivingLicenceNumber", licensenumber: "drivingLicenceNumber",
  licenceexpiry: "licenceExpiry", licenseexpiry: "licenceExpiry", tachoname: "tachoName", tachomasterdriverid: "tachoMasterDriverId", tachocardnumber: "tachoCardNumber", mobilenumber: "mobileNumber", mobile: "mobileNumber",
  registration: "registration", reg: "registration", fleetnumber: "fleetNumber", fleetno: "fleetNumber", abbreviation: "abbreviation", fuelprovider: "fuelProvider", fuelpin: "fuelPin",
  shellcard: "shellCard", bpredcard: "bpRedCard", bpplaincard: "bpPlainCard", fuelpinsecretname: "fuelPinSecretName", fuelcardlastfour: "fuelCardLastFour",
  trailernumber: "trailerNumber", trailerno: "trailerNumber", standardcapacity: "standardCapacity", eurocapacity: "euroCapacity", type: "type",
  externalcode: "externalCode", sitecode: "externalCode", sitename: "name", name: "name", drivertextname: "driverTextName", collectionaddress: "collectionAddress", collectioninstructions: "collectionInstructions", aliases: "aliases", operationalregion: "operationalRegion", latitude: "latitude", longitude: "longitude",
  market: "market", marketname: "market", standorlocation: "standOrLocation", stallnumber: "standOrLocation", salesman: "salesman", sender: "sender",
  routecombination: "routeCombination", route: "routeCombination", pallettype: "palletType", lastdespatch: "lastDespatch", collectfrom: "collectFrom", collectto: "collectTo", depotdeadline: "depotDeadline", depotdeliverynolaterthan: "depotDeadline",
  active: "active", notes: "notes",
};

function key(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]/g, ""); }
function fieldName(value: string) { const compact = key(value); return aliases[compact] || value.trim().replace(/^./, c => c.toLowerCase()).replace(/\s+(.)/g, (_, c: string) => c.toUpperCase()); }
function normaliseDate(value: string) { const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : value; }
function typedValue(field: string, raw: string): string | number | boolean {
  if (field === "active") return !["false", "no", "0", "inactive"].includes(raw.trim().toLowerCase());
  if (["standardCapacity", "euroCapacity", "latitude", "longitude"].includes(field) && /^-?\d+(\.\d+)?$/.test(raw.trim())) return Number(raw);
  if (field.toLowerCase().includes("expiry") || field.toLowerCase().endsWith("date")) return normaliseDate(raw.trim());
  return raw.trim();
}
function comparable(value: unknown) { return value == null ? "" : String(value).trim().toLowerCase().replace(/\s+/g, " "); }
function sameCompact(left: unknown, right: unknown) { return comparable(left).replace(/\s/g, "") === comparable(right).replace(/\s/g, ""); }

export function parseCsvRows(text: string) {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; }
    else if (!quoted && character === ",") { row.push(value.trim()); value = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) { if (character === "\r" && text[index + 1] === "\n") index += 1; row.push(value.trim()); value = ""; if (row.some(Boolean)) rows.push(row); row = []; }
    else value += character;
  }
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row); return rows;
}

export function parseMasterDataCsv(text: string, entity: MasterEntity, fileName: string): ParsedMasterCsv {
  const rows = parseCsvRows(text); if (rows.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
  const headers = rows[0].map(fieldName); const warnings: string[] = []; const preview: FlatPayload[] = []; const requests: StageBatchRequest[] = [];
  rows.slice(1).forEach((cells, index) => {
    const payload: FlatPayload = {};
    headers.forEach((header, column) => { const raw = cells[column] ?? ""; if (raw !== "") payload[header] = typedValue(header, raw); });
    const identities = identityFields[entity].map(field => payload[field]).filter(value => value != null && String(value).trim());
    if (entity === "marketcontact" && identities.length < 2) { warnings.push(`Row ${index + 2} was skipped because market contacts require market and name.`); return; }
    if (!identities.length) { warnings.push(`Row ${index + 2} was skipped because it has no ${identityFields[entity].join(" / ")} identity.`); return; }
    preview.push(payload);
    requests.push({ entityType: entity, idempotencyKey: `csv-reconcile:${entity}:${identities.map(v => key(String(v))).join(":")}`, source: `Reviewed master-data CSV · ${fileName}`, payload });
  });
  if (!requests.length) throw new Error("No importable master-data rows were found in the CSV.");
  return { requests, headers, preview: preview.slice(0, 6), warnings };
}

function identityMatch(entity: MasterEntity, payload: FlatPayload, current: FlatPayload) {
  switch (entity) {
    case "driver": return payload.employeeNumber ? comparable(payload.employeeNumber) === comparable(current.employeeNumber) : comparable(payload.displayName) === comparable(current.displayName);
    case "vehicle": return sameCompact(payload.registration, current.registration);
    case "trailer": return comparable(payload.trailerNumber) === comparable(current.trailerNumber);
    case "site": return payload.externalCode ? comparable(payload.externalCode) === comparable(current.externalCode) : comparable(payload.name) === comparable(current.name);
    case "marketcontact": return comparable(payload.market) === comparable(current.market) && comparable(payload.name) === comparable(current.name);
    case "sitetimingrule": return comparable(payload.routeCombination) === comparable(current.routeCombination);
  }
}

export function compareMasterDataRow(entity: MasterEntity, request: StageBatchRequest, currentRecords: FlatPayload[]): DiffRow {
  const payload = request.payload as FlatPayload;
  const current = currentRecords.find(record => identityMatch(entity, payload, record));
  if (!current) return { request, status: "NEW", differences: Object.keys(payload), selected: true };
  const differences = Object.entries(payload).filter(([, value]) => comparable(value) !== "").filter(([field, value]) => comparable(current[field]) !== comparable(value)).map(([field]) => field);
  if (!differences.length) return { request, current, status: "UNCHANGED", differences: [], selected: false };
  const critical = differences.some(field => protectedFields[entity].includes(field));
  return { request, current, status: critical ? "CRITICAL REVIEW" : "UPDATE", differences, selected: !critical };
}

export async function applyMasterDataInChunks(records: StageBatchRequest[], applyBatch: (batch: StageBatchRequest[]) => Promise<MasterApplyResponse>, chunkSize = MASTER_IMPORT_CHUNK_SIZE, onProgress?: (completed: number, total: number) => void): Promise<MasterApplyResponse> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("Import chunk size must be at least 1.");
  const aggregate: MasterApplyResponse = { received: 0, applied: 0, registered: 0, failed: 0, linked: 0, results: [] };
  for (let offset = 0; offset < records.length; offset += chunkSize) {
    const batch = records.slice(offset, offset + chunkSize); const result = await applyBatch(batch);
    aggregate.received += result.received; aggregate.applied += result.applied; aggregate.registered = (aggregate.registered ?? 0) + (result.registered ?? 0); aggregate.failed += result.failed; aggregate.linked = (aggregate.linked ?? 0) + (result.linked ?? 0); aggregate.results.push(...result.results);
    onProgress?.(Math.min(offset + batch.length, records.length), records.length);
  }
  return aggregate;
}

export function MasterDataCsvImport() {
  const token = useAccessToken();
  const [entity, setEntity] = useState<MasterEntity>("site"); const [fileName, setFileName] = useState(""); const [parsed, setParsed] = useState<ParsedMasterCsv>();
  const [diffRows, setDiffRows] = useState<DiffRow[]>([]); const [message, setMessage] = useState<string>(); const [error, setError] = useState<string>(); const [saving, setSaving] = useState(false);
  const previewHeaders = useMemo(() => parsed ? Array.from(new Set(parsed.preview.flatMap(row => Object.keys(row)))).slice(0, 10) : [], [parsed]);
  const selected = diffRows.filter(row => row.selected && row.status !== "UNCHANGED");

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; setParsed(undefined); setDiffRows([]); setMessage(undefined); setError(undefined); if (!file) return; setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("Choose a .csv file."); return; }
    try {
      const result = parseMasterDataCsv(await file.text(), entity, file.name); setParsed(result); setMessage("Comparing uploaded values with live TMS master data…");
      const accessToken = await token();
      const live = await request<{ records: FlatPayload[] }>(`/api/v1/master-data/reconcile?entityType=${encodeURIComponent(entity)}`, accessToken, undefined, 90000);
      const compared = result.requests.map(row => compareMasterDataRow(entity, row, live.records || [])); setDiffRows(compared);
      const counts = compared.reduce<Record<string, number>>((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
      setMessage(`${compared.length} rows compared · ${counts.NEW || 0} new · ${counts.UPDATE || 0} updates · ${counts["CRITICAL REVIEW"] || 0} critical review · ${counts.UNCHANGED || 0} unchanged.`);
    } catch (exception) { setError(exception instanceof Error ? exception.message : "The CSV could not be reconciled."); }
  }

  async function apply() {
    if (!selected.length) return; setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const accessToken = await token();
      const result = await applyMasterDataInChunks(selected.map(row => row.request), batch => request<MasterApplyResponse>("/api/v1/master-data/reconcile/apply", accessToken, { method: "POST", body: JSON.stringify(batch) }, 90000), MASTER_IMPORT_CHUNK_SIZE, (completed, total) => setMessage(`Applying reviewed changes… ${completed} of ${total}.`));
      setMessage(`${result.applied} safely applied${result.failed ? ` · ${result.failed} failed` : ""}. Blank upload fields preserved the live TMS values.`);
      if (result.failed) { const failures = result.results.filter(item => !item.applied).map(item => item.error).filter(Boolean).slice(0, 5); if (failures.length) setError(failures.join(" · ")); }
    } catch (exception) { setError(exception instanceof Error ? exception.message : "The reviewed master-data changes could not be applied."); }
    finally { setSaving(false); }
  }

  return <section className="panel master-csv-import">
    <div className="title-row"><div><p className="eyebrow">Protected reconciliation</p><h2>Master data CSV</h2><p className="hint">Upload, compare with live TMS, review differences, then apply. Blank cells never erase populated live values. Fuel cards, driver identity/compliance, markets and site timing changes require explicit review.</p></div></div>
    <div className="master-csv-controls">
      <label>Master type<select value={entity} onChange={event => { setEntity(event.target.value as MasterEntity); setParsed(undefined); setDiffRows([]); setFileName(""); setMessage(undefined); setError(undefined); }}>
        <option value="site">Sites / aliases</option><option value="sitetimingrule">Site timing / cut-offs</option><option value="driver">Drivers / licences / Tacho</option><option value="vehicle">Vehicles / fuel cards</option><option value="trailer">Trailers / capacities</option><option value="marketcontact">Markets / stall & stand</option>
      </select></label>
      <label>CSV file<input type="file" accept="text/csv,.csv" onChange={event => void chooseFile(event)} /></label>{fileName && <strong>{fileName}</strong>}
    </div>
    {message && <p className="notice ready">{message}</p>}{error && <p className="notice">{error}</p>}{parsed?.warnings.length ? <p className="notice inline-notice">{parsed.warnings.slice(0, 8).join(" · ")}</p> : null}
    {diffRows.length ? <div className="master-csv-preview"><table className="master-table"><thead><tr><th>Apply</th><th>Status</th><th>Identity</th><th>Changed fields</th><th>Current → Uploaded</th></tr></thead><tbody>{diffRows.map((row, index) => {
      const payload = row.request.payload as FlatPayload; const identity = identityFields[entity].map(field => payload[field]).filter(Boolean).join(" · ");
      const detail = row.differences.slice(0, 5).map(field => `${field}: ${String(row.current?.[field] ?? "—")} → ${String(payload[field] ?? "—")}`).join(" | ");
      return <tr key={`${row.request.idempotencyKey}-${index}`}><td><input type="checkbox" checked={row.selected} disabled={row.status === "UNCHANGED"} onChange={event => setDiffRows(rows => rows.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} /></td><td><strong>{row.status}</strong></td><td>{identity}</td><td>{row.differences.join(", ") || "None"}</td><td>{detail || "Already identical"}</td></tr>;
    })}</tbody></table></div> : parsed?.preview.length ? <div className="master-csv-preview"><table className="master-table"><thead><tr>{previewHeaders.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{parsed.preview.map((row, index) => <tr key={index}>{previewHeaders.map(header => <td key={header}>{String(row[header] ?? "")}</td>)}</tr>)}</tbody></table></div> : null}
    <div className="actions"><button type="button" className="primary" disabled={!selected.length || saving} onClick={() => void apply()}>{saving ? "Applying…" : `Apply ${selected.length} selected change${selected.length === 1 ? "" : "s"}`}</button></div>
  </section>;
}
