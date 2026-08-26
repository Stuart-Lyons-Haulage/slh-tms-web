from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one anchor in {path}, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


# Navigation: keep imports out of the daily workflow and place them last.
replace_once(
    "src/App.tsx",
    "const dailyNavigation = [\n  ['/dashboard', 'Dashboard'], ['/operations-wallboard', 'Operations wallboard'], ['/staging', 'Review orders'], ['/', 'Planner'], ['/pallet-control', 'Pallet control'], ['/planner-import', 'Import planner plan'], ['/loads', 'Runs'], ['/tracking', 'Live tracking'],\n];\nconst masterNavigation = [['/master-data', 'Master data']];\nconst insightNavigation = [\n  ['/management', 'Management'], ['/night-outs', 'Driver hours / Compliance'], ['/plan-stability', 'Plan stability'], ['/control-centre', 'Control centre'], ['/reporting', 'Reporting'], ['/exports', 'Exports'],\n];",
    "const dailyNavigation = [\n  ['/dashboard', 'Dashboard'], ['/operations-wallboard', 'Operations wallboard'], ['/staging', 'Review orders'], ['/', 'Planner'], ['/pallet-control', 'Pallet control'], ['/loads', 'Runs'], ['/tracking', 'Live tracking'],\n];\nconst masterNavigation = [['/master-data', 'Master data']];\nconst insightNavigation = [\n  ['/management', 'Management'], ['/night-outs', 'Driver hours / Compliance'], ['/plan-stability', 'Plan stability'], ['/control-centre', 'Control centre'], ['/reporting', 'Reporting'], ['/exports', 'Exports'],\n];\nconst importNavigation = [['/planner-import', 'Imports']];"
)
replace_once(
    "src/App.tsx",
    "      <NavSection title=\"Control & insight\" storageKey=\"slh-nav-insight\" items={insightNavigation} current={location.pathname} closeMobile={closeMobile}/>\n      {authenticated && <button className=\"mobile-sign-out\"",
    "      <NavSection title=\"Control & insight\" storageKey=\"slh-nav-insight\" items={insightNavigation} current={location.pathname} closeMobile={closeMobile}/>\n      <NavSection title=\"Imports\" storageKey=\"slh-nav-imports\" items={importNavigation} current={location.pathname} closeMobile={closeMobile}/>\n      {authenticated && <button className=\"mobile-sign-out\""
)

# Planner: remove duplicate order-review and subcontractor panels.
write("src/pages/PlannerEnhanced.tsx", r'''import { Link } from "react-router-dom";
import { useState } from "react";
import { OptimiserProposalReview } from "../components/OptimiserProposalReview";
import { signalPlanningChange } from "../lib/planningEvents";
import { RunPlannerLive } from "./RunPlannerLive";

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function PlannerEnhanced() {
  const [date, setDate] = useState(localDate());

  return <section className="planner-enhanced-page">
    <div className="panel planner-screen-switcher" style={{ marginBottom: 14, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 3 }}>Planning workspace</p>
        <strong>Run Planner</strong><br />
        <small>Build and amend runs here. Order approval stays in Review orders; live quantity control stays on the planner's second screen.</small>
      </div>
      <Link className="button-like primary" to="/pallet-control" target="_blank" rel="noopener noreferrer">Open Pallet Control · Screen 2 ↗</Link>
    </div>

    <div className="planner-toolbar" style={{ marginTop: 0 }}>
      <label>
        Plan date{" "}
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <span>Approved orders for this date appear automatically in the planning pool.</span>
    </div>

    <OptimiserProposalReview planningDate={date} onApplied={() => signalPlanningChange()} />
    <RunPlannerLive planningDate={date} />

    <div className="mobile-planner-handoff">
      <strong>Allocation and dispatch are on Runs.</strong>
      <span>After the plan is built, assign the driver, vehicle and trailer from Runs. Master records and subcontractor details are maintained outside this planning workspace.</span>
      <Link to="/loads">Open Runs →</Link>
    </div>
  </section>;
}
''')

# Run builder: capacity label is misleading once quantities can be trays/trolleys.
replace_once(
    "src/pages/RunPlannerLive.tsx",
    "          const pallets = runTotal(run);\n          const saving = busyKey === run.key || busyKey?.startsWith(`${run.key}:`);",
    "          const saving = busyKey === run.key || busyKey?.startsWith(`${run.key}:`);"
)
replace_once(
    "src/pages/RunPlannerLive.tsx",
    "              <div className={`simple-run-pallets ${pallets > 26 ? \"over\" : \"\"}`}><strong>{pallets}</strong><small>/ 26 pallets</small></div>\n",
    ""
)
replace_once(
    "src/pages/RunPlannerLive.tsx",
    "          <small>Click an order on the right. Pallet changes auto-save.</small>",
    "          <small>Click an order on the right. Run quantity changes auto-save.</small>"
)

# Optimiser: generation frequently exceeds the old 60-second client timeout.
optimiser = read("src/components/OptimiserProposalReview.tsx")
if optimiser.count("}, 60000);") < 2:
    raise SystemExit("Optimiser timeout anchors changed")
write("src/components/OptimiserProposalReview.tsx", optimiser.replace("}, 60000);", "}, 180000);"))

# Review orders: horizontally scroll a deeper history and surface all pending dates; arbitrary date remains available.
replace_once(
    "src/pages/OrderReviewBulk.tsx",
    '''function rollingDates() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Array.from({ length: 11 }, (_, index) => {
    const value = new Date(today);
    value.setDate(today.getDate() + index - 3);
    return dateKey(value);
  });
}''',
    '''function rollingDates() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Array.from({ length: 53 }, (_, index) => {
    const value = new Date(today);
    value.setDate(today.getDate() + index - 45);
    return dateKey(value);
  });
}'''
)
replace_once(
    "src/pages/OrderReviewBulk.tsx",
    "  const dateRange = useMemo(rollingDates, []);\n  const today = useMemo(todayDate, []);",
    "  const dateRange = useMemo(rollingDates, []);\n  const today = useMemo(todayDate, []);\n  const pendingOrderDates = useMemo(() => Array.from(new Set(rows.flatMap((row) => [text(row.payload.collectionDate), text(row.payload.deliveryDate)]).filter(Boolean))).sort(), [rows]);\n  const visibleDates = useMemo(() => Array.from(new Set([...dateRange, ...pendingOrderDates, date])).sort(), [date, dateRange, pendingOrderDates]);"
)
replace_once(
    "src/pages/OrderReviewBulk.tsx",
    "  const summaries = useMemo(() => dateRange.map<DateSummary>((planningDate) => {",
    "  const summaries = useMemo(() => visibleDates.map<DateSummary>((planningDate) => {"
)
replace_once(
    "src/pages/OrderReviewBulk.tsx",
    "  }), [dateRange, rows]);",
    "  }), [rows, visibleDates]);"
)
replace_once(
    "src/pages/OrderReviewBulk.tsx",
    "        <p className=\"hint\">Use the rolling dates to see three days back, today and the next seven days. Counts come from the live approval queue.</p>",
    "        <p className=\"hint\">Scroll the date bubbles for recent history and every day that still has work waiting. Use Jump to date for any other historical day.</p>"
)
replace_once(
    "src/pages/OrderReviewBulk.tsx",
    "    <div className=\"order-date-strip\" role=\"tablist\" aria-label=\"Order review planning dates\">",
    "    <div className=\"order-date-history-controls\">\n      <label>Jump to date <input type=\"date\" value={date} onChange={(event) => selectDate(event.target.value)} disabled={busy || Boolean(busyId)} /></label>\n      <button type=\"button\" onClick={() => selectDate(today)} disabled={busy || Boolean(busyId)}>Today</button>\n      <small>45 days of recent history + all dates still waiting</small>\n    </div>\n\n    <div className=\"order-date-strip\" role=\"tablist\" aria-label=\"Order review planning dates\">"
)

# Master data: remove destructive rebuild and JSON bulk uploader from the operational master screen.
master = read("src/pages/MasterDataHub.tsx")
master = master.replace("import { MasterDataUploadSmall } from './MasterDataUploadSmall';\n", "")
master = master.replace("import { MasterDataResetImportPanel } from './MasterDataResetImportPanel';\n", "")
master = master.replace("\n    <MasterDataResetImportPanel onApplied={() => setRefreshKey(value => value + 1)} />\n    <MasterDataUploadSmall onApplied={() => setRefreshKey(value => value + 1)} />\n", "\n")
write("src/pages/MasterDataHub.tsx", master)

# Generic reviewed CSV master-data import kept under the low-frequency Imports area.
write("src/pages/MasterDataCsvImport.tsx", r'''import { useMemo, useState, type ChangeEvent } from "react";
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
''')

write("src/pages/MasterDataCsvImport.test.ts", r'''import { describe, expect, it } from "vitest";
import { parseMasterDataCsv, parseCsvRows } from "./MasterDataCsvImport";

describe("MasterDataCsvImport", () => {
  it("parses quoted CSV fields", () => {
    expect(parseCsvRows('Driver Number,Driver Name\nD01,"Smith, Alex"\n')).toEqual([["Driver Number", "Driver Name"], ["D01", "Smith, Alex"]]);
  });

  it("maps driver sanity-check headers and normalises licence expiry", () => {
    const parsed = parseMasterDataCsv("Driver Number,Driver Name,Licence Number,Licence Expiry\nD01,Alex Smith,SMITH123,31/12/2027\n", "driver", "drivers.csv");
    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0].payload).toMatchObject({ employeeNumber: "D01", displayName: "Alex Smith", drivingLicenceNumber: "SMITH123", licenceExpiry: "2027-12-31" });
  });
});
''')

# Import Centre now owns all low-frequency import tools, including the safe CSV sanity route.
write("src/pages/ImportCentre.tsx", r'''import { useState } from "react";
import { ManualContingencyImport } from "./ManualContingencyImport";
import { OrdersOperationalV2 } from "./OrdersOperationalV2";
import { PlannerPlanImport } from "./PlannerPlanImport";
import { MasterDataCsvImport } from "./MasterDataCsvImport";

type ImportTab = "planner" | "orders" | "contingency" | "master-csv";

export function ImportCentre({ initialTab = "planner" }: { initialTab?: ImportTab }) {
  const [tab, setTab] = useState<ImportTab>(initialTab);
  return <section className="import-centre">
    <section className="panel import-centre-heading">
      <div className="title-row"><div>
        <p className="eyebrow">Contingency tools</p>
        <h1>Imports</h1>
        <p className="intro">These are fallback and reconciliation tools, not part of the normal daily workflow. Info-mailbox orders should continue through Review orders automatically.</p>
      </div></div>
      <div className="import-centre-tabs" role="tablist" aria-label="Import type">
        <button type="button" className={tab === "planner" ? "primary" : ""} onClick={() => setTab("planner")}>Planner plan</button>
        <button type="button" className={tab === "orders" ? "primary" : ""} onClick={() => setTab("orders")}>Orders</button>
        <button type="button" className={tab === "contingency" ? "primary" : ""} onClick={() => setTab("contingency")}>Manual contingency</button>
        <button type="button" className={tab === "master-csv" ? "primary" : ""} onClick={() => setTab("master-csv")}>Master data CSV</button>
      </div>
    </section>
    <div className="import-centre-body">
      {tab === "planner" && <PlannerPlanImport />}
      {tab === "orders" && <OrdersOperationalV2 />}
      {tab === "contingency" && <ManualContingencyImport />}
      {tab === "master-csv" && <MasterDataCsvImport />}
    </div>
  </section>;
}
''')

# Control Centre becomes one continuous page, avoiding duplicated views/tabs.
write("src/pages/ControlCentre.tsx", r'''import { AdminIntegrationSyncControls } from '../components/AdminIntegrationSyncControls';
import { Admin } from './Pages';
import { OperationsControlClean } from './OperationsControlClean';

export function ControlCentre() {
  return <section className="control-centre-one-page">
    <div className="title-row">
      <div>
        <p className="eyebrow">Control & administration</p>
        <h1>Control centre</h1>
        <p className="intro">One continuous operational control page: live confidence first, then integration health and administration. No duplicated switchable views.</p>
      </div>
    </div>

    <OperationsControlClean />

    <div className="control-centre-admin-divider">
      <p className="eyebrow">Integrations & administration</p>
      <h2>Platform controls</h2>
      <p className="hint">Use these only when an integration or platform control needs attention.</p>
    </div>
    <AdminIntegrationSyncControls />
    <Admin />
  </section>;
}
''')

# Dashboard: a daily health funnel plus exceptions and source freshness.
write("src/pages/DashboardOperational.tsx", r'''import { useCallback } from "react";
import { Link } from "react-router-dom";
import { intelligenceApi } from "../lib/intelligenceApi";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate, formatDateLong } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";

function feedAge(minutes?: number) {
  if (minutes == null) return "No recent update";
  if (minutes < 1) return "Live";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function DashboardOperational() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));
  const attention = useApi(useCallback(async () => intelligenceApi.attention(date, await token()), [date, token]));
  const freshness = useApi(useCallback(async () => intelligenceApi.freshness(await token()), [token]));
  const snapshot = readiness.data;
  const readyRuns = snapshot ? Math.max(0, snapshot.runs - snapshot.missingAllocations) : 0;
  const highAttention = attention.data?.items.filter((item) => item.severity === "High").length || 0;

  const refreshAll = () => void Promise.all([readiness.refresh(), attention.refresh(), freshness.refresh()]);

  return <section className="dashboard-health-page">
    <div className="title-row dashboard-health-title">
      <div>
        <p className="eyebrow">Operational health · {formatDateLong(date)}</p>
        <h1>Today at a glance</h1>
        <p className="hint">A decision-focused view of today's orders, runs, people, fleet, exceptions and the systems feeding the operation.</p>
      </div>
      <button type="button" onClick={refreshAll} disabled={readiness.loading || attention.loading || freshness.loading}>Refresh all</button>
    </div>

    {readiness.error && <p className="notice inline-notice">Operational health could not refresh: {readiness.error}</p>}
    {snapshot && <>
      <div className={`dashboard-health-state ${snapshot.ready ? "good" : "attention"}`}>
        <div><span>{snapshot.ready ? "✓" : "!"}</span><div><small>Operational health</small><strong>{snapshot.ready ? "READY TO OPERATE" : "ACTION REQUIRED"}</strong></div></div>
        <p>{snapshot.runs} runs today · {readyRuns} fully allocated · {attention.data?.count || 0} active exception{attention.data?.count === 1 ? "" : "s"}</p>
      </div>

      <div className="dashboard-health-grid">
        <Link to="/staging"><article className={snapshot.unreviewedOrders ? "attention" : "good"}><span>Orders waiting</span><strong>{snapshot.unreviewedOrders}</strong><small>Need review / approval</small></article></Link>
        <Link to="/"><article className={snapshot.missingAllocations ? "attention" : "good"}><span>Runs ready</span><strong>{readyRuns}/{snapshot.runs}</strong><small>{snapshot.missingAllocations} need allocation</small></article></Link>
        <Link to="/fleet-assets"><article className={snapshot.vorConflicts ? "attention" : "good"}><span>Fleet / VOR</span><strong>{snapshot.vorConflicts}</strong><small>Conflicts against today's plan</small></article></Link>
        <Link to="/night-outs"><article className={snapshot.tachoConcerns ? "attention" : "good"}><span>Driver compliance</span><strong>{snapshot.tachoConcerns}</strong><small>Hours / Tacho concerns</small></article></Link>
        <Link to="/attention"><article className={highAttention ? "attention" : "good"}><span>High priority</span><strong>{highAttention}</strong><small>{attention.data?.count || 0} total exceptions</small></article></Link>
        <Link to="/loads"><article className={snapshot.planLock ? "good" : "neutral"}><span>Plan baseline</span><strong>{snapshot.planLock ? "Locked" : "Open"}</strong><small>{snapshot.planLock ? `${snapshot.planLock.baselineRuns} baseline runs` : "Not locked yet"}</small></article></Link>
      </div>
    </>}

    <div className="dashboard-health-columns">
      <section className="panel dashboard-attention-panel">
        <div className="title-row"><div><p className="eyebrow">Today's attention</p><h2>What needs a decision</h2></div><Link to="/attention">Open all →</Link></div>
        {attention.error && <p className="notice inline-notice">Exceptions could not refresh: {attention.error}</p>}
        {attention.data?.items.length ? <div className="dashboard-attention-list">{attention.data.items.slice(0, 6).map((item) => <Link key={item.id} to={item.href} className={`dashboard-attention-row severity-${item.severity.toLowerCase()}`}><span>{item.severity}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><b>→</b></Link>)}</div> : <p className="hint">No active operational exceptions are being reported for today.</p>}
      </section>

      <section className="panel dashboard-feed-panel">
        <div className="title-row"><div><p className="eyebrow">System feeds</p><h2>Is the picture trustworthy?</h2></div><Link to="/control-centre">Control centre →</Link></div>
        {freshness.error && <p className="notice inline-notice">Feed freshness could not refresh: {freshness.error}</p>}
        <div className="dashboard-feed-list">{freshness.data?.sources.map((feed) => <div key={feed.name} className={`dashboard-feed-row feed-${feed.state}`}><span aria-hidden="true" /><div><strong>{feed.name}</strong><small>{feedAge(feed.ageMinutes)}</small></div><b>{feed.state.toUpperCase()}</b></div>)}</div>
      </section>
    </div>

    <div className="dashboard-handoff-links"><Link to="/staging">Review orders →</Link><Link to="/">Planner →</Link><Link to="/pallet-control">Pallet control →</Link><Link to="/operations-wallboard">Live operations →</Link></div>
  </section>;
}
''')

# Pallet Control: compact split-screen To plan / Planned, no mode tabs.
write("src/pages/PalletPlanningControl.tsx", r'''import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type Allocation = { loadId: string; loadReference?: string; pallets: number; updatedAtUtc: string; updatedBy?: string };
type PlanningOrder = {
  id: string; reference: string; customerCode: string; collectionDate: string; deliveryDate?: string;
  deliveryWindowStartUtc?: string; deliveryWindowEndUtc?: string; orderedPallets: number; plannedPallets: number;
  outstandingPallets: number; overplannedPallets: number; collection: string; destination: string; planningGroup: string;
  temperature?: string; palletType?: string; source?: string; receivedAtUtc: string; lateAddition: boolean; allocations: Allocation[];
};
type PlanningCell = { planningGroup: string; destination: string; ordered: number; planned: number; outstanding: number; overplanned: number; orderIds: string[] };
type PlanningRun = { id: string; reference: string; status: string; stopCount: number };
type PlanningControlData = {
  date: string; generatedAtUtc: string;
  summary: { ordered: number; planned: number; outstanding: number; overplanned: number; lateAdditions: number; orders: number; runs: number };
  planningGroups: string[]; destinations: string[]; cells: PlanningCell[]; orders: PlanningOrder[]; runs: PlanningRun[];
};
type RegionData = { date: string; destinations: string[]; destinationRegions: Record<string, string> };
type ViewMode = "toPlan" | "planned";
type PalletTone = "standard" | "euro" | "mixed" | "unknown";

const PLANNING_CHANNEL = "slh-planning-control";
const PLANNING_STORAGE_KEY = "slh:planning-control-changed";

function planningDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function ukDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function fmtTime(value?: string) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
function palletTone(value?: string): PalletTone { const clean = String(value || "").toLowerCase(); if (clean.includes("euro")) return "euro"; if (clean.includes("standard") || clean.includes("std")) return "standard"; return "unknown"; }
function palletLabel(value?: string) { const tone = palletTone(value); return tone === "standard" ? "Standard" : tone === "euro" ? "Euro" : value || "Unknown"; }
function toneBackground(tone: PalletTone) { if (tone === "standard") return "#dbeafe"; if (tone === "euro") return "#ffedd5"; if (tone === "mixed") return "linear-gradient(135deg, #dbeafe 0 50%, #ffedd5 50% 100%)"; return "#f3f4f6"; }
function toneBorder(tone: PalletTone) { if (tone === "standard") return "#2563eb"; if (tone === "euro") return "#ea580c"; if (tone === "mixed") return "#7c3aed"; return "#9ca3af"; }
function notifyPlanningChanged() { window.dispatchEvent(new Event("slh:orders-changed")); try { window.localStorage.setItem(PLANNING_STORAGE_KEY, String(Date.now())); } catch { /* ignore */ } if ("BroadcastChannel" in window) { const channel = new BroadcastChannel(PLANNING_CHANNEL); channel.postMessage({ type: "planning-changed", at: Date.now() }); channel.close(); } }

export function PalletPlanningControl() {
  const token = useAccessToken();
  const [date, setDate] = useState(planningDate());
  const [selectedCell, setSelectedCell] = useState<{ group: string; destination: string }>();
  const [message, setMessage] = useState<string>();
  const [busyKey, setBusyKey] = useState<string>();
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, { loadId: string; pallets: string }>>({});
  const control = useApi(useCallback(async () => request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, await token()), [date, token]));
  const regions = useApi(useCallback(async () => request<RegionData>(`/api/v1/planning-control/regions?date=${encodeURIComponent(date)}`, await token()), [date, token]));
  const refreshControl = control.refresh; const refreshRegions = regions.refresh;

  useEffect(() => {
    const refresh = () => { void refreshControl(); void refreshRegions(); };
    const id = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 2000);
    const onFocus = () => refresh(); const onVisibility = () => { if (document.visibilityState === "visible") refresh(); }; const onOrderChanged = () => refresh();
    const onStorage = (event: StorageEvent) => { if (event.key === PLANNING_STORAGE_KEY) refresh(); };
    const channel = "BroadcastChannel" in window ? new BroadcastChannel(PLANNING_CHANNEL) : undefined; if (channel) channel.onmessage = refresh;
    window.addEventListener("focus", onFocus); window.addEventListener("storage", onStorage); window.addEventListener("slh:orders-changed", onOrderChanged); document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(id); channel?.close(); window.removeEventListener("focus", onFocus); window.removeEventListener("storage", onStorage); window.removeEventListener("slh:orders-changed", onOrderChanged); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refreshControl, refreshRegions]);

  const data = control.data;
  const orderById = useMemo(() => new Map((data?.orders || []).map((order) => [order.id, order])), [data?.orders]);
  const orderedDestinations = useMemo(() => { if (!data) return []; const live = new Set(data.destinations); const ranked = (regions.data?.destinations || []).filter((destination) => live.has(destination)); return [...ranked, ...data.destinations.filter((destination) => !ranked.includes(destination))]; }, [data, regions.data]);
  const regionGroups = useMemo(() => { const groups: Array<{ region: string; destinations: string[] }> = []; for (const destination of orderedDestinations) { const region = regions.data?.destinationRegions?.[destination] || "Other"; const last = groups[groups.length - 1]; if (last?.region === region) last.destinations.push(destination); else groups.push({ region, destinations: [destination] }); } return groups; }, [orderedDestinations, regions.data]);
  const cellMap = useMemo(() => new Map((data?.cells || []).map((cell) => [`${cell.planningGroup}|||${cell.destination}`, cell])), [data?.cells]);
  const selectedOrders = useMemo(() => !data || !selectedCell ? [] : data.orders.filter((order) => order.planningGroup === selectedCell.group && order.destination === selectedCell.destination), [data, selectedCell]);

  const quantity = (mode: ViewMode, cell?: PlanningCell) => mode === "planned" ? cell?.planned || 0 : cell?.outstanding || 0;
  const orderQuantity = (mode: ViewMode, order: PlanningOrder) => mode === "planned" ? order.plannedPallets : order.outstandingPallets;
  function cellTone(mode: ViewMode, cell?: PlanningCell): PalletTone { if (!cell) return "unknown"; const tones = new Set<PalletTone>(); for (const id of cell.orderIds) { const order = orderById.get(id); if (!order || orderQuantity(mode, order) <= 0) continue; const tone = palletTone(order.palletType); if (tone !== "unknown") tones.add(tone); } if (tones.has("standard") && tones.has("euro")) return "mixed"; if (tones.has("standard")) return "standard"; if (tones.has("euro")) return "euro"; return "unknown"; }

  function currentDraft(order: PlanningOrder) { return allocationDrafts[order.id] || { loadId: order.allocations[0]?.loadId || data?.runs[0]?.id || "", pallets: String(order.allocations[0]?.pallets ?? order.outstandingPallets ?? order.orderedPallets) }; }
  function selectRun(order: PlanningOrder, loadId: string) { const existing = order.allocations.find((allocation) => allocation.loadId === loadId)?.pallets; setAllocationDrafts((current) => ({ ...current, [order.id]: { loadId, pallets: String(existing ?? order.outstandingPallets) } })); }
  async function saveAllocation(order: PlanningOrder) {
    const draftValue = currentDraft(order); if (!draftValue.loadId) { setMessage("Select a run before allocating pallets."); return; }
    const pallets = Number(draftValue.pallets); if (!Number.isInteger(pallets) || pallets < 0) { setMessage("Enter a whole pallet quantity of zero or more."); return; }
    setBusyKey(order.id); setMessage(undefined);
    try {
      const result = await request<{ outstandingPallets: number; overplannedPallets: number; loadReference: string }>("/api/v1/planning-control/allocations", await token(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id, loadId: draftValue.loadId, date, pallets, note: "Updated from live Pallet Control" }) });
      setMessage(`${order.reference}: ${pallets} allocated · ${result.outstandingPallets} remaining${result.overplannedPallets > 0 ? ` · ${result.overplannedPallets} over-planned` : ""}.`);
      setAllocationDrafts((current) => { const next = { ...current }; delete next[order.id]; return next; }); notifyPlanningChanged(); await Promise.all([refreshControl(), refreshRegions()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The pallet allocation could not be saved."); } finally { setBusyKey(undefined); }
  }

  function matrix(mode: ViewMode, title: string, total: number) {
    return <section className={`panel pallet-control-column ${mode === "toPlan" ? "to-plan" : "planned"}`}>
      <div className="pallet-control-column-title"><div><p className="eyebrow">{mode === "toPlan" ? "Work remaining" : "Allocated work"}</p><h2>{title}</h2></div><strong>{total}</strong></div>
      <div className="pallet-control-matrix-wrap"><table className="master-table pallet-control-matrix">
        <thead>
          <tr><th className="sticky-first">Region</th>{regionGroups.map((group) => <th key={group.region} colSpan={group.destinations.length}>{group.region}</th>)}<th>Total</th></tr>
          <tr><th className="sticky-first">Collection</th>{orderedDestinations.map((destination) => <th key={destination} className="vertical-destination">{destination}</th>)}<th>Total</th></tr>
        </thead>
        <tbody>
          {data?.planningGroups.map((group) => {
            const cells = orderedDestinations.map((destination) => cellMap.get(`${group}|||${destination}`)); const rowTotal = cells.reduce((sum, cell) => sum + quantity(mode, cell), 0);
            if (rowTotal === 0 && !(mode === "toPlan" && cells.some((cell) => (cell?.overplanned || 0) > 0))) return null;
            return <tr key={group}><td className="sticky-first"><strong>{group}</strong></td>{orderedDestinations.map((destination, index) => {
              const cell = cells[index]; const amount = quantity(mode, cell); const over = cell?.overplanned || 0; const tone = cellTone(mode, cell);
              return <td key={destination}>{amount > 0 || (mode === "toPlan" && over > 0) ? <button type="button" className="pallet-cell-button" style={{ background: toneBackground(tone), borderColor: toneBorder(tone) }} onClick={() => setSelectedCell({ group, destination })} title={`${group} → ${destination}: ${cell?.ordered || 0} ordered, ${cell?.planned || 0} planned, ${cell?.outstanding || 0} to plan`}><strong>{amount || "—"}</strong>{mode === "toPlan" && over > 0 ? <small>+{over}</small> : null}</button> : null}</td>;
            })}<td><strong>{rowTotal}</strong></td></tr>;
          })}
          <tr className="destination-totals"><td className="sticky-first"><strong>Destination total</strong></td>{orderedDestinations.map((destination) => { const totalForDestination = data?.planningGroups.reduce((sum, group) => sum + quantity(mode, cellMap.get(`${group}|||${destination}`)), 0) || 0; return <td key={destination}><strong>{totalForDestination || ""}</strong></td>; })}<td><strong>{total}</strong></td></tr>
        </tbody>
      </table></div>
    </section>;
  }

  return <section className="pallet-control-page">
    <div className="title-row pallet-control-header"><div><p className="eyebrow">Planner second screen · live quantity control</p><h1>Pallet control</h1><p className="intro">The left side empties as work is planned; the right side fills with allocated work.</p></div><div className="title-actions"><label>Planning date <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedCell(undefined); }} /></label><button onClick={() => { void refreshControl(); void refreshRegions(); }} disabled={control.loading}>Refresh</button><Link className="button-like primary" to="/">Open planner</Link></div></div>
    <div className="pallet-control-legend"><span><i style={{ background: toneBackground("standard"), borderColor: toneBorder("standard") }} />Standard</span><span><i style={{ background: toneBackground("euro"), borderColor: toneBorder("euro") }} />Euro</span><span><i style={{ background: toneBackground("mixed"), borderColor: toneBorder("mixed") }} />Mixed</span><small>{ukDate(date)} · {data?.summary.orders || 0} orders · {data?.summary.runs || 0} runs · updated {fmtTime(data?.generatedAtUtc)}</small></div>
    {message && <p className="notice inline-notice">{message}</p>}{control.error && <p className="notice inline-notice">{control.error}</p>}
    {data && <div className="pallet-control-mini-metrics"><article><span>To plan</span><strong>{data.summary.outstanding}</strong></article><article><span>Planned</span><strong>{data.summary.planned}</strong></article><article className={data.summary.overplanned ? "attention" : ""}><span>Over-planned</span><strong>{data.summary.overplanned}</strong></article><article><span>Late additions</span><strong>{data.summary.lateAdditions}</strong></article></div>}
    {data && data.summary.orders === 0 && <div className="state">No approved pallet orders are available for {ukDate(date)}.</div>}
    {data && <div className="pallet-control-columns">{matrix("toPlan", "To plan", data.summary.outstanding)}{matrix("planned", "Planned", data.summary.planned)}</div>}

    {selectedCell && data && <section className="panel pallet-control-detail"><div className="title-row"><div><p className="eyebrow">Underlying orders</p><h2>{selectedCell.group} → {selectedCell.destination}</h2><p className="hint">Partial allocations remain in To plan until the outstanding balance reaches zero.</p></div><button onClick={() => setSelectedCell(undefined)}>Close</button></div><div className="pallet-control-order-list">{selectedOrders.map((order) => { const draft = currentDraft(order); const tone = palletTone(order.palletType); return <article key={order.id} className="pallet-control-order"><div><strong>{order.reference}</strong><small>{order.customerCode} · {order.collection} → {order.destination}</small><small>{palletLabel(order.palletType)} · {order.temperature || "No temp"}{order.lateAddition ? " · NEW AFTER PLANNING STARTED" : ""}</small></div><div className="pallet-control-order-quantities"><span><small>Ordered</small><strong>{order.orderedPallets}</strong></span><span><small>Planned</small><strong>{order.plannedPallets}</strong></span><span><small>To plan</small><strong>{order.outstandingPallets}</strong></span></div><div className="pallet-control-allocation"><select value={draft.loadId} onChange={(event) => selectRun(order, event.target.value)}><option value="">Select run</option>{data.runs.map((run) => <option key={run.id} value={run.id}>{run.reference} · {run.status}</option>)}</select><input type="number" min="0" step="1" value={draft.pallets} onChange={(event) => setAllocationDrafts((current) => ({ ...current, [order.id]: { ...draft, pallets: event.target.value } }))} /><button type="button" className="primary" disabled={busyKey === order.id || !draft.loadId} onClick={() => void saveAllocation(order)}>{busyKey === order.id ? "Saving…" : "Save"}</button></div></article>; })}</div></section>}
  </section>;
}
''')

# New stylesheet is deliberately additive, so existing established screens are not restyled globally.
write("src/operations-housekeeping.css", r'''.dashboard-health-page { display: grid; gap: 14px; }
.dashboard-health-title { margin-bottom: 0; }
.dashboard-health-state { display: flex; justify-content: space-between; gap: 18px; align-items: center; padding: 16px 18px; border: 1px solid #cbdde1; border-radius: 12px; background: #f8fbfc; }
.dashboard-health-state > div { display: flex; gap: 12px; align-items: center; }
.dashboard-health-state > div > span { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; font-weight: 900; font-size: 1.2rem; background: #e7f3ef; color: #1f6b4e; }
.dashboard-health-state.attention > div > span { background: #fff1cf; color: #805900; }
.dashboard-health-state strong, .dashboard-health-state small { display: block; }
.dashboard-health-state p { margin: 0; color: #5b707b; }
.dashboard-health-grid { display: grid; grid-template-columns: repeat(6, minmax(135px, 1fr)); gap: 9px; }
.dashboard-health-grid a { color: inherit; text-decoration: none; }
.dashboard-health-grid article { height: 100%; box-sizing: border-box; padding: 12px 13px; border: 1px solid #d4e1e4; border-radius: 10px; background: #fff; }
.dashboard-health-grid article.good { border-top: 4px solid #2f7d5d; }
.dashboard-health-grid article.attention { border-top: 4px solid #b7791f; background: #fffaf0; }
.dashboard-health-grid article.neutral { border-top: 4px solid #80939c; }
.dashboard-health-grid span, .dashboard-health-grid small { display: block; color: #637984; }
.dashboard-health-grid strong { display: block; margin: 4px 0; font-size: 1.6rem; color: #173d50; }
.dashboard-health-columns { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(300px, .8fr); gap: 12px; }
.dashboard-attention-list, .dashboard-feed-list { display: grid; gap: 7px; }
.dashboard-attention-row { display: grid; grid-template-columns: 62px 1fr auto; gap: 10px; align-items: center; padding: 9px 10px; border: 1px solid #d8e3e6; border-radius: 8px; color: inherit; text-decoration: none; }
.dashboard-attention-row > span { font-size: .72rem; font-weight: 900; text-transform: uppercase; }
.dashboard-attention-row strong, .dashboard-attention-row small { display: block; }
.dashboard-attention-row small { margin-top: 2px; color: #6a7e88; }
.dashboard-attention-row.severity-high { border-left: 4px solid #a33a32; }
.dashboard-attention-row.severity-medium { border-left: 4px solid #b7791f; }
.dashboard-attention-row.severity-low { border-left: 4px solid #4d7c91; }
.dashboard-feed-row { display: grid; grid-template-columns: auto 1fr auto; gap: 9px; align-items: center; padding: 10px; border-bottom: 1px solid #e2eaec; }
.dashboard-feed-row > span { width: 10px; height: 10px; border-radius: 50%; background: #7f9199; }
.dashboard-feed-row.feed-green > span { background: #2f7d5d; }.dashboard-feed-row.feed-amber > span { background: #c18423; }.dashboard-feed-row.feed-red > span { background: #a33a32; }
.dashboard-feed-row strong, .dashboard-feed-row small { display: block; }.dashboard-feed-row small { color: #70828a; }.dashboard-feed-row b { font-size: .7rem; letter-spacing: .05em; }
.dashboard-handoff-links { display: flex; gap: 10px; flex-wrap: wrap; padding: 4px 2px; font-weight: 800; }

.order-date-history-controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.order-date-history-controls label { display: inline-flex; align-items: center; gap: 7px; font-weight: 800; color: #405d69; }
.order-date-history-controls small { color: #738790; }
.order-date-strip { display: flex !important; grid-template-columns: none !important; gap: 8px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; padding-bottom: 8px; }
.order-date-strip button { flex: 0 0 76px; scroll-snap-align: start; }
.order-waiting-bubbles { flex-wrap: nowrap !important; overflow-x: auto; padding-bottom: 4px; }
.order-waiting-bubbles button { flex: 0 0 auto; }

.pallet-control-page { font-size: .92rem; }
.pallet-control-header { margin-bottom: 5px; }.pallet-control-header .intro { margin-bottom: 0; }
.pallet-control-legend { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 5px 0 8px; }
.pallet-control-legend span { display: inline-flex; gap: 5px; align-items: center; }.pallet-control-legend i { width: 13px; height: 13px; border: 2px solid; border-radius: 3px; }.pallet-control-legend small { margin-left: auto; color: #71838c; }
.pallet-control-mini-metrics { display: grid; grid-template-columns: repeat(4, minmax(100px, 1fr)); gap: 7px; margin-bottom: 8px; }
.pallet-control-mini-metrics article { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 7px 10px; border: 1px solid #d5e0e4; border-radius: 8px; background: #fff; }.pallet-control-mini-metrics strong { font-size: 1.25rem; color: #173d50; }.pallet-control-mini-metrics article.attention { background: #fff8e8; border-color: #e1c06c; }
.pallet-control-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; height: calc(100vh - 285px); min-height: 390px; }
.pallet-control-column { min-width: 0; padding: 9px !important; display: grid; grid-template-rows: auto 1fr; overflow: hidden; }.pallet-control-column.to-plan { border-top: 4px solid #b7791f; }.pallet-control-column.planned { border-top: 4px solid #2f7d5d; }
.pallet-control-column-title { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 5px; }.pallet-control-column-title h2, .pallet-control-column-title p { margin: 0; }.pallet-control-column-title > strong { font-size: 1.6rem; color: #173d50; }
.pallet-control-matrix-wrap { min-height: 0; overflow: auto; border: 1px solid #d7e2e5; border-radius: 7px; }
.pallet-control-matrix { min-width: 760px; border-collapse: separate; border-spacing: 0; font-size: .76rem; }.pallet-control-matrix th, .pallet-control-matrix td { padding: 3px !important; text-align: center; }.pallet-control-matrix .sticky-first { position: sticky; left: 0; z-index: 3; min-width: 135px; text-align: left; background: #f4f8f9; }.pallet-control-matrix thead .sticky-first { z-index: 5; }.pallet-control-matrix .vertical-destination { min-width: 48px; height: 95px; writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; }.pallet-control-matrix .destination-totals td { position: sticky; bottom: 0; background: #f4f8f9; z-index: 2; }
.pallet-cell-button { width: 100%; min-width: 34px; min-height: 31px; padding: 2px 4px; border: 1px solid; border-radius: 5px; }.pallet-cell-button strong, .pallet-cell-button small { display: block; }.pallet-cell-button small { color: #9a4e00; }
.pallet-control-detail { margin-top: 10px; }.pallet-control-order-list { display: grid; gap: 6px; max-height: 46vh; overflow: auto; }.pallet-control-order { display: grid; grid-template-columns: minmax(220px, 1.3fr) auto minmax(300px, 1fr); gap: 12px; align-items: center; padding: 8px 10px; border: 1px solid #dae4e7; border-radius: 8px; }.pallet-control-order strong, .pallet-control-order small { display: block; }.pallet-control-order small { color: #71838c; }.pallet-control-order-quantities { display: flex; gap: 12px; }.pallet-control-order-quantities span { text-align: center; }.pallet-control-order-quantities strong { font-size: 1.15rem; }.pallet-control-allocation { display: grid; grid-template-columns: 1fr 72px auto; gap: 6px; }

.control-centre-one-page { display: grid; gap: 16px; }.control-centre-admin-divider { margin-top: 4px; padding-top: 16px; border-top: 2px solid #cbdde1; }.control-centre-admin-divider h2, .control-centre-admin-divider p { margin-top: 0; }
.master-csv-import { display: grid; gap: 12px; }.master-csv-controls { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }.master-csv-controls label { display: grid; gap: 5px; font-weight: 800; }.master-csv-preview { overflow: auto; max-height: 300px; border: 1px solid #d8e3e6; border-radius: 8px; }

@media (max-width: 1250px) { .dashboard-health-grid { grid-template-columns: repeat(3, 1fr); }.pallet-control-columns { grid-template-columns: 1fr; height: auto; }.pallet-control-column { height: 46vh; }.pallet-control-order { grid-template-columns: 1fr; }.pallet-control-allocation { grid-template-columns: minmax(180px, 1fr) 80px auto; } }
@media (max-width: 850px) { .dashboard-health-state, .dashboard-health-columns { display: grid; grid-template-columns: 1fr; }.dashboard-health-grid { grid-template-columns: repeat(2, 1fr); }.pallet-control-mini-metrics { grid-template-columns: repeat(2, 1fr); }.pallet-control-legend small { width: 100%; margin-left: 0; } }
''')
replace_once("src/main.tsx", "import './live-vehicle-popup.css';\n", "import './live-vehicle-popup.css';\nimport './operations-housekeeping.css';\n")

print("Operations housekeeping patch applied")
