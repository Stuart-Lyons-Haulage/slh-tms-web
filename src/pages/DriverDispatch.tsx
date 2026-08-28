import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, request, type LoadDispatch, type Trailer, type Vehicle } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../driver-dispatch.css";

type DispatchDriver = {
  driverId: string;
  employeeNumber: string;
  displayName: string;
  driverType: "Employed" | "Casual" | "Agency";
  driverGroup?: string;
  skills?: string;
  coding?: string;
  agencyName?: string;
  tachoMasterDriverId?: string;
  tachoCardNumber?: string;
  dayNumber: number;
  onLeave: boolean;
  leaveType?: string;
  leaveDetails?: string;
  partDayLeave: boolean;
  previousLoadId?: string;
  previousRunReference?: string;
  previousVehicleId?: string;
  previousVehicleRegistration?: string;
  previousFinalStop?: string;
  previousFinalLatitude?: number;
  previousRoute?: string;
  assignedLoadId?: string;
  assignedRunCount: number;
  suggestedRunId?: string;
  suggestedRunReference?: string;
  suggestedVehicleId?: string;
  suggestedVehicleRegistration?: string;
  assistantScore?: number;
  suggestion?: string;
  agencyBookedFrom?: string;
  agencyBookedThrough?: string;
};

type DispatchStop = {
  id: string;
  sequence: number;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  plannedArrivalUtc?: string;
  plannerNote?: string;
};

type DispatchLoad = {
  id: string;
  reference: string;
  rawReference: string;
  planningDate: string;
  status: string;
  driverId?: string;
  vehicleId?: string;
  trailerId?: string;
  palletSpacesUsed?: number;
  totalPalletSpaces?: number;
  capacityType?: string;
  plannerNotes?: string;
  southbound: boolean;
  plannedStartUtc?: string;
  stops: DispatchStop[];
};

type Workbench = {
  planningDate: string;
  weekStart?: string;
  weekEnd?: string;
  generatedAtUtc: string;
  leaveSource: string;
  driverPopulationSource?: string;
  dayNumberSource?: string;
  assistantSource?: string;
  drivers: DispatchDriver[];
  vehicles: Vehicle[];
  trailers: Trailer[];
  loads: DispatchLoad[];
};

type DispatchReadiness = {
  canDispatch: boolean;
  status: string;
  explanation: string;
  routeDrivingMinutes: number;
  breakMinutesIncluded: number;
  structuralReadiness?: {
    classification: "Recommended" | "Unverified" | "Blocked";
    requiresAcknowledgement: boolean;
    checks: Array<{ code: string; passed: boolean; severity: string; message: string }>;
  };
};

type MessageMode = "dispatch" | "update";
type MessageState = { load: DispatchLoad; mode: MessageMode; text: string; routeMinutes?: number; acknowledgeUnverified?: boolean };
type DriverType = "Employed" | "Casual" | "Agency";
type DriverForm = {
  displayName: string;
  employeeNumber: string;
  driverType: DriverType;
  agencyName: string;
  startDate: string;
  days: number;
};
type AddDriverResponse = { message?: string; created?: boolean; driverId?: string };
type DispatchFilterKey = "driver" | "typeSkills" | "code" | "day" | "previous" | "vehicle" | "trailer" | "run" | "firstCollection" | "assistant" | "dispatch";
type DispatchFilters = Record<DispatchFilterKey, string>;
type SearchOption = { id: string; label: string; search?: string };

const dispatchFilterKeys: DispatchFilterKey[] = ["driver", "typeSkills", "code", "day", "previous", "vehicle", "trailer", "run", "firstCollection", "assistant", "dispatch"];
const dispatchFilterPlaceholders: Record<DispatchFilterKey, string> = {
  driver: "Driver…",
  typeSkills: "Type / skill…",
  code: "Code…",
  day: "Day…",
  previous: "Yesterday finish…",
  vehicle: "Vehicle…",
  trailer: "Trailer…",
  run: "Run…",
  firstCollection: "1st collection…",
  assistant: "Assistant…",
  dispatch: "Status…",
};

function emptyDispatchFilters(): DispatchFilters {
  return Object.fromEntries(dispatchFilterKeys.map(key => [key, ""])) as DispatchFilters;
}
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return isoDate(new Date(year, month - 1, day + days, 12));
}
function today() { return isoDate(new Date()); }
const dispatchTimeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function localTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dispatchTimeFormatter.format(date);
}
function compactRun(load?: DispatchLoad) {
  if (!load) return "—";
  const match = `${load.reference} ${load.rawReference}`.match(/\b(?:run\s*)?(\d{1,3})\b/i);
  const core = match?.[1] || load.reference;
  return `${load.southbound ? "SB " : ""}${core}`;
}
function cleanStopName(value?: string) {
  return (value || "").replace(/^(?:Collect|Deliver)\s*[·:-]\s*/i, "").replace(/-/g, " ").trim();
}
function orderedStops(load?: DispatchLoad) { return [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence); }
export function firstCollectionStop(load?: DispatchLoad) {
  const stops = orderedStops(load);
  return stops.find(stop => /^Collect\b/i.test(stop.name || "")) || stops[0];
}
function finalDestinationStop(load?: DispatchLoad) {
  const stops = orderedStops(load);
  return [...stops].reverse().find(stop => /^Deliver\b/i.test(stop.name || "")) || stops.at(-1);
}
export function suggestionRunLabel(load: DispatchLoad) {
  const match = `${load.reference} ${load.rawReference}`.match(/\b(?:run\s*)?(\d{1,3})\b/i);
  const run = match?.[1] ? `Run ${Number(match[1])}` : load.reference;
  const destination = cleanStopName(finalDestinationStop(load)?.name);
  return destination ? `${run} ${destination}` : run;
}
export function runDirection(load: DispatchLoad) {
  const stops = orderedStops(load).filter(stop => stop.latitude != null && stop.longitude != null);
  const first = stops[0];
  const final = finalDestinationStop(load);
  if (first?.latitude != null && final?.latitude != null) {
    const delta = final.latitude - first.latitude;
    if (delta >= 0.35) return "Northern";
    if (delta <= -0.35) return "Southern";
  }
  if (load.southbound) return "Southern";
  return "Local / Other";
}
function firstCollectionTime(load?: DispatchLoad) { return localTime(firstCollectionStop(load)?.plannedArrivalUtc); }

function runOptionLabel(load: DispatchLoad, drivers: DispatchDriver[]) {
  const allocatedDriver = load.driverId ? drivers.find(driver => driver.driverId === load.driverId) : undefined;
  const allocation = load.driverId ? ` · allocated${allocatedDriver ? ` to ${allocatedDriver.displayName}` : ""}` : "";
  return `${suggestionRunLabel(load)}${allocation}`;
}
function typeLetter(type: string) { return type === "Agency" ? "A" : type === "Casual" ? "C" : "E"; }
function skillBadges(value?: string) {
  return (value || "").split(/[,;|/]+/).map(item => item.trim()).filter(Boolean).slice(0, 5);
}
function routeMinutes(route: Record<string, unknown>) {
  const routes = route.routes as Array<{ summary?: { travelTimeInSeconds?: number } }> | undefined;
  const seconds = routes?.[0]?.summary?.travelTimeInSeconds;
  return typeof seconds === "number" && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : undefined;
}
function buildDriverText(load: DispatchLoad, dispatch: LoadDispatch) {
  const collectionTime = firstCollectionTime(load);
  const lines = [
    `SLH ${load.southbound ? "Southbound " : ""}${load.reference}`,
    dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : "",
    collectionTime ? `Your first collection is at ${collectionTime}` : "Your first collection time is TBC",
    dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registration}` : "",
    dispatch.trailer ? `Trailer: ${dispatch.trailer.trailerNumber}` : "",
    load.palletSpacesUsed != null ? `Load: ${load.palletSpacesUsed}${load.totalPalletSpaces ? ` / ${load.totalPalletSpaces}` : ""} ${load.capacityType || "load units"}` : "",
    "",
    ...dispatch.stops.flatMap(stop => [
      `${stop.sequence}. ${stop.name}`,
      stop.address ? `Address: ${stop.address}` : "",
      stop.order?.reference ? `Ref: ${stop.order.reference}` : "",
      stop.order?.marketName ? `Market: ${stop.order.marketName}${stop.order.stallNumber ? ` · Stall ${stop.order.stallNumber}` : ""}` : "",
      stop.order?.sellerName ? `Seller: ${stop.order.sellerName}` : "",
      stop.order?.driverInstructions ? `Notes: ${stop.order.driverInstructions}` : "",
      stop.order?.mapLink ? `Map: ${stop.order.mapLink}` : "",
      "",
    ]),
    "Please reply to confirm receipt.",
  ];
  return lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n").trim();
}

async function allocateRun(id: string, payload: { vehicleId?: string; driverId?: string; trailerId?: string }, access: string) {
  return request<unknown>(`/api/v1/runs/${encodeURIComponent(id)}/allocation`, access, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

function TypeaheadSelect({ value, options, onChange, placeholder, disabled, listId }: {
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  listId: string;
}) {
  const selected = options.find(option => option.id === value);
  const [text, setText] = useState(selected?.label || "");
  const [open, setOpen] = useState(false);
  useEffect(() => { setText(selected?.label || ""); }, [value, selected?.label]);

  const matches = useMemo(() => {
    const query = text.trim().toLowerCase();
    return (query ? options.filter(option => `${option.label} ${option.search || ""}`.toLowerCase().includes(query)) : options).slice(0, 18);
  }, [options, text]);

  function choose(option: SearchOption) {
    setText(option.label);
    onChange(option.id);
    setOpen(false);
  }

  function resolve() {
    const query = text.trim().toLowerCase();
    if (!query) { setText(""); onChange(""); return; }
    const exact = options.find(option => option.label.toLowerCase() === query);
    if (exact) { choose(exact); return; }
    if (matches.length === 1) { choose(matches[0]); return; }
    setText(selected?.label || "");
  }

  return <div className="dispatch-typeahead">
    <input
      id={listId}
      role="combobox"
      aria-expanded={open}
      aria-controls={`${listId}-options`}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      onFocus={() => setOpen(true)}
      onChange={event => {
        const next = event.target.value;
        setText(next);
        setOpen(true);
        if (!next.trim()) onChange("");
      }}
      onBlur={() => window.setTimeout(() => { setOpen(false); resolve(); }, 120)}
      onKeyDown={event => {
        if (event.key === "Enter" && matches[0]) { event.preventDefault(); choose(matches[0]); }
        if (event.key === "Escape") { setOpen(false); setText(selected?.label || ""); }
        if (event.key === "ArrowDown") setOpen(true);
      }}
    />
    {open && !disabled && <div id={`${listId}-options`} className="dispatch-typeahead-menu" role="listbox">
      {matches.length === 0 ? <span className="dispatch-typeahead-empty">No matching option</span> : matches.map(option => <button
        key={option.id}
        type="button"
        role="option"
        aria-selected={option.id === value}
        className={option.id === value ? "selected" : ""}
        onMouseDown={event => event.preventDefault()}
        onClick={() => choose(option)}
      >{option.label}</button>)}
    </div>}
  </div>;
}

export function DriverDispatch() {
  const token = useAccessToken();
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [date, setDate] = useState(initialParams.get("date") || today());
  const readOnly = initialParams.get("compare") === "1";
  const [data, setData] = useState<Workbench>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<MessageState>();
  const [showDriverTools, setShowDriverTools] = useState(false);
  const [driverToolBusy, setDriverToolBusy] = useState(false);
  const [driverToolNotice, setDriverToolNotice] = useState<string>();
  const [filters, setFilters] = useState<DispatchFilters>(() => emptyDispatchFilters());
  const [driverForm, setDriverForm] = useState<DriverForm>({
    displayName: "",
    employeeNumber: "",
    driverType: "Agency",
    agencyName: "",
    startDate: date,
    days: 7,
  });

  const refresh = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      setData(await request<Workbench>(`/api/v1/driver-dispatch?date=${encodeURIComponent(date)}`, await token(), undefined, 90000));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Driver Dispatch could not be loaded.");
    } finally { setLoading(false); }
  }, [date, token]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("date", date);
    if (readOnly) params.set("compare", "1");
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [date, readOnly]);
  useEffect(() => { setDriverForm(current => ({ ...current, startDate: date })); }, [date]);

  const filteredDrivers = useMemo(() => {
    if (!data) return [];
    return data.drivers.filter(driver => {
      const assigned = data.loads.find(load => load.id === driver.assignedLoadId);
      const vehicle = assigned?.vehicleId ? data.vehicles.find(item => item.id === assigned.vehicleId) : undefined;
      const trailer = assigned?.trailerId ? data.trailers.find(item => item.id === assigned.trailerId) : undefined;
      const values: Record<DispatchFilterKey, string> = {
        driver: `${driver.displayName} ${driver.employeeNumber}`,
        typeSkills: `${driver.driverType} ${driver.driverGroup || ""} ${driver.skills || ""} ${driver.agencyName || ""}`,
        code: driver.coding || "",
        day: String(driver.dayNumber),
        previous: `${driver.previousFinalStop || ""} ${driver.previousRoute || ""} ${driver.previousRunReference || ""}`,
        vehicle: `${vehicle?.registration || ""} ${driver.previousVehicleRegistration || ""} ${driver.suggestedVehicleRegistration || ""}`,
        trailer: `${trailer?.trailerNumber || ""} ${trailer?.type || ""}`,
        run: assigned ? `${suggestionRunLabel(assigned)} ${assigned.reference} ${assigned.rawReference}` : `${driver.suggestedRunReference || ""} unallocated`,
        firstCollection: firstCollectionTime(assigned),
        assistant: `${driver.suggestion || ""} ${driver.previousFinalStop || ""} ${driver.assistantScore ?? ""}`,
        dispatch: assigned ? `${assigned.status} allocated` : "unallocated",
      };
      return dispatchFilterKeys.every(key => {
        const query = filters[key].trim().toLowerCase();
        return !query || values[key].toLowerCase().includes(query);
      });
    });
  }, [data, filters]);

  const yesterday = () => window.open(`/driver-dispatch?date=${encodeURIComponent(addDays(date, -1))}&compare=1`, "_blank", "noopener,noreferrer");

  async function syncDrivers() {
    if (readOnly) return;
    setDriverToolBusy(true); setDriverToolNotice(undefined);
    try {
      await request(`/api/v1/driver-master/tachomaster/sync`, await token(), { method: "POST" }, 180000);
      setDriverToolNotice("Driver Master sync completed. Dispatch has been refreshed.");
      await refresh();
    } catch (exception) {
      setDriverToolNotice(exception instanceof Error ? exception.message : "Driver Master sync failed.");
    } finally { setDriverToolBusy(false); }
  }

  async function addDriver() {
    if (readOnly) return;
    if (!driverForm.displayName.trim()) { setDriverToolNotice("Enter the driver's name."); return; }
    if (driverForm.driverType === "Agency" && !driverForm.agencyName.trim()) { setDriverToolNotice("Enter the agency name."); return; }
    if (driverForm.driverType !== "Agency" && !driverForm.employeeNumber.trim()) { setDriverToolNotice("Enter the employee number, or use Sync Drivers first."); return; }
    setDriverToolBusy(true); setDriverToolNotice(undefined);
    try {
      const result = await request<AddDriverResponse>(`/api/v1/driver-dispatch/drivers`, await token(), {
        method: "POST",
        body: JSON.stringify({
          displayName: driverForm.displayName.trim(),
          employeeNumber: driverForm.employeeNumber.trim() || null,
          driverType: driverForm.driverType,
          agencyName: driverForm.driverType === "Agency" ? driverForm.agencyName.trim() : null,
          startDate: driverForm.startDate,
          days: driverForm.driverType === "Agency" ? Number(driverForm.days) : null,
        }),
      }, 90000);
      setDriverToolNotice(result.message || "Driver saved.");
      setDriverForm(current => ({ ...current, displayName: "", employeeNumber: "" }));
      await refresh();
    } catch (exception) {
      setDriverToolNotice(exception instanceof Error ? exception.message : "Driver could not be added.");
    } finally { setDriverToolBusy(false); }
  }

  return <section className={`driver-dispatch-page ${readOnly ? "comparison-mode" : ""}`}>
    <div className="title-row dispatch-title">
      <div>
        <p className="eyebrow">Planning → allocation → route → driver text</p>
        <h1>{readOnly ? "Driver Dispatch · comparison" : "Driver Dispatch"}</h1>
        <p className="hint">{readOnly ? "Read-only comparison screen. Keep this beside today's plan." : "Allocate the driver, vehicle, trailer and run from one row. Changes autosave immediately; the first collection time comes from the run plan."}</p>
      </div>
      <div className="title-actions dispatch-actions">
        <label>Planning date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <button type="button" onClick={yesterday}>Open yesterday in new screen ↗</button>
        {!readOnly && <button type="button" onClick={() => void syncDrivers()} disabled={driverToolBusy}>{driverToolBusy ? "Working…" : "Sync Drivers"}</button>}
        {!readOnly && <button type="button" onClick={() => { setShowDriverTools(value => !value); setDriverToolNotice(undefined); }}>{showDriverTools ? "Close driver add" : "Add Driver"}</button>}
        <button type="button" onClick={() => void refresh()} disabled={loading}>Refresh</button>
      </div>
    </div>

    {!readOnly && showDriverTools && <div className="dispatch-driver-tools">
      <div>
        <strong>Add or roster a driver</strong>
        <p className="hint">Use Sync Drivers first where possible. If the driver is new to us, this creates a provisional identity that the next TachoMaster sync can bind.</p>
      </div>
      <label>Driver name<input value={driverForm.displayName} onChange={event => setDriverForm(current => ({ ...current, displayName: event.target.value }))} placeholder="Full name" /></label>
      <label>Type<select value={driverForm.driverType} onChange={event => setDriverForm(current => ({ ...current, driverType: event.target.value as DriverType }))}><option value="Employed">Employed</option><option value="Casual">Casual</option><option value="Agency">Agency</option></select></label>
      {driverForm.driverType !== "Agency" && <label>Employee number<input value={driverForm.employeeNumber} onChange={event => setDriverForm(current => ({ ...current, employeeNumber: event.target.value }))} placeholder="Employee number" /></label>}
      {driverForm.driverType === "Agency" && <>
        <label>Agency<input value={driverForm.agencyName} onChange={event => setDriverForm(current => ({ ...current, agencyName: event.target.value }))} placeholder="Agency name" /></label>
        <label>Available from<input type="date" value={driverForm.startDate} onChange={event => setDriverForm(current => ({ ...current, startDate: event.target.value }))} /></label>
        <label>How many days do we have them?<input type="number" min={1} max={7} value={driverForm.days} onChange={event => setDriverForm(current => ({ ...current, days: Math.max(1, Math.min(7, Number(event.target.value) || 1)) }))} /></label>
      </>}
      <button className="primary" type="button" onClick={() => void addDriver()} disabled={driverToolBusy}>{driverToolBusy ? "Saving…" : driverForm.driverType === "Agency" ? "Add to this week's roster" : "Add driver"}</button>
    </div>}
    {driverToolNotice && <p className="notice inline-notice">{driverToolNotice}</p>}

    {readOnly && <p className="notice inline-notice"><strong>Comparison view:</strong> no allocations can be changed from this window.</p>}
    {error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{error}</p>}
    {loading && !data && <div className="state">Building Driver Dispatch from the planning-week roster, run plan and Sage HR…</div>}
    {data && <>
      <div className="dispatch-summary">
        <span><strong>{filteredDrivers.length === data.drivers.length ? data.drivers.length : `${filteredDrivers.length} / ${data.drivers.length}`}</strong> planning drivers</span>
        <span><strong>{data.loads.filter(load => !load.driverId).length}</strong> runs to plan</span>
        <span><strong>{data.loads.length - data.loads.filter(load => !load.driverId).length}</strong> allocated runs</span>
        <span><strong>{data.drivers.filter(driver => Boolean(driver.suggestedRunId) && !driver.assignedLoadId).length}</strong> assistant matches</span>
        <span><strong>{data.drivers.filter(driver => driver.onLeave).length}</strong> away / leave</span>
        <span>Leave: <strong>{data.leaveSource}</strong></span>
        {data.weekStart && data.weekEnd && <span>Week: <strong>{new Date(`${data.weekStart}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" })} → {new Date(`${data.weekEnd}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" })}</strong></span>}
        {dispatchFilterKeys.some(key => filters[key]) && <button type="button" className="text-button clear-dispatch-filters" onClick={() => setFilters(emptyDispatchFilters())}>Clear filters</button>}
      </div>
      <RunsToPlanSummary loads={data.loads} />
      <div className="dispatch-table-wrap">
        <table className="dispatch-table">
          <thead>
            <tr><th>Driver</th><th>Type / skills</th><th>Code</th><th>Day</th><th>Yesterday finish</th><th>Vehicle</th><th>Trailer</th><th>Run</th><th>1st collection</th><th>Assistant</th><th>Dispatch</th></tr>
            <tr className="dispatch-filter-row">{dispatchFilterKeys.map(key => <th key={key}><input aria-label={`Filter ${key}`} value={filters[key]} placeholder={dispatchFilterPlaceholders[key]} onChange={event => setFilters(current => ({ ...current, [key]: event.target.value }))} /></th>)}</tr>
          </thead>
          <tbody>{filteredDrivers.map((driver, index) => <DispatchRow
            key={driver.driverId}
            driver={driver}
            data={data}
            readOnly={readOnly}
            showGroup={index === 0 || filteredDrivers[index - 1].driverType !== driver.driverType}
            token={token}
            refresh={refresh}
            openMessage={setMessage}
          />)}</tbody>
        </table>
      </div>
      <p className="hint">Dispatch is a driver-only operational roster. Compliance continues to run behind dispatch readiness but is no longer a planning column. Allocations autosave as the planner selects a run, vehicle or trailer. The Assistant uses yesterday's finishing position, Day number, route direction, skills/code and regular vehicle history; the Runs to Plan board only shows work that still needs a driver.</p>
    </>}

    {message && <MessageDialog state={message} token={token} close={() => setMessage(undefined)} sent={async () => { setMessage(undefined); await refresh(); }} />}
  </section>;
}

function PlanningRunChip({ load }: { load: DispatchLoad }) {
  const collection = firstCollectionStop(load);
  return <span className="plan-run-chip" tabIndex={0}>
    <strong>{suggestionRunLabel(load)}</strong>
    <small>{firstCollectionTime(load) ? `1st collect ${firstCollectionTime(load)}` : "1st collect TBC"}</small>
    <span className="plan-run-popover">
      <b>{load.reference}</b>
      {orderedStops(load).map(stop => <span key={stop.id}>{stop.sequence}. {cleanStopName(stop.name)}{stop.plannedArrivalUtc ? ` · ${localTime(stop.plannedArrivalUtc)}` : ""}</span>)}
      {collection && <em>First collection: {cleanStopName(collection.name)}</em>}
    </span>
  </span>;
}

function RunsToPlanSummary({ loads }: { loads: DispatchLoad[] }) {
  const remaining = loads.filter(load => !load.driverId);
  const groups = ["Northern", "Southern", "Local / Other"].map(direction => ({ direction, loads: remaining.filter(load => runDirection(load) === direction) }));
  return <div className="runs-to-plan-board">
    <div className="runs-to-plan-heading"><div><strong>Runs to Plan</strong><small>Only unallocated runs are shown. Autosaved allocations disappear from this board.</small></div><span>{remaining.length} remaining</span></div>
    {remaining.length === 0 ? <div className="runs-to-plan-empty">All planned runs have a driver allocated.</div> : <div className="runs-to-plan-groups">
      {groups.filter(group => group.loads.length > 0).map(group => <section key={group.direction} className={`runs-to-plan-group direction-${group.direction.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
        <header><strong>{group.direction === "Northern" ? "NORTHERN / NORTHBOUND" : group.direction === "Southern" ? "SOUTHERN / SOUTHBOUND" : "LOCAL / OTHER"}</strong><span>{group.loads.length}</span></header>
        <div>{group.loads.sort((a, b) => compactRun(a).localeCompare(compactRun(b), undefined, { numeric: true })).map(load => <PlanningRunChip key={load.id} load={load} />)}</div>
      </section>)}
    </div>}
  </div>;
}

function PreviousRouteHover({ driver }: { driver: DispatchDriver }) {
  const finish = cleanStopName(driver.previousFinalStop);
  const route = (driver.previousRoute || "").split(" → ").filter(Boolean);
  if (!finish && route.length === 0) return <span className="previous-finish-empty">—</span>;
  return <span className="previous-route-hover" tabIndex={0}>
    <strong>{finish || route.at(-1)}</strong>
    {driver.previousRunReference && <small>{driver.previousRunReference}</small>}
    {route.length > 0 && <span className="previous-route-popover"><b>Previous day route</b>{route.map((stop, index) => <span key={`${stop}-${index}`}>{index + 1}. {stop}</span>)}</span>}
  </span>;
}

function DispatchRow({ driver, data, readOnly, showGroup, token, refresh, openMessage }: {
  driver: DispatchDriver;
  data: Workbench;
  readOnly: boolean;
  showGroup: boolean;
  token: () => Promise<string>;
  refresh: () => Promise<void>;
  openMessage: (state: MessageState) => void;
}) {
  const initial = data.loads.find(load => load.id === driver.assignedLoadId);
  const [loadId, setLoadId] = useState(initial?.id || "");
  const [vehicleId, setVehicleId] = useState(initial?.vehicleId || driver.previousVehicleId || "");
  const [trailerId, setTrailerId] = useState(initial?.trailerId || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const selected = data.loads.find(load => load.id === loadId);
  const suggestedLoad = driver.suggestedRunId ? data.loads.find(load => load.id === driver.suggestedRunId) : undefined;
  const firstCollection = firstCollectionStop(selected);
  const availableLoads = data.loads.filter(load => !load.driverId || load.driverId === driver.driverId || load.id === driver.assignedLoadId).sort((left, right) => {
    if (left.id === driver.suggestedRunId) return -1;
    if (right.id === driver.suggestedRunId) return 1;
    if (Boolean(left.driverId) !== Boolean(right.driverId)) return left.driverId ? 1 : -1;
    return compactRun(left).localeCompare(compactRun(right), undefined, { numeric: true });
  });
  const vehicleOptions: SearchOption[] = [...data.vehicles].sort((left, right) => {
    const leftRank = left.id === driver.suggestedVehicleId ? 0 : left.id === driver.previousVehicleId ? 1 : 2;
    const rightRank = right.id === driver.suggestedVehicleId ? 0 : right.id === driver.previousVehicleId ? 1 : 2;
    return leftRank - rightRank || left.registration.localeCompare(right.registration);
  }).map(vehicle => ({
    id: vehicle.id,
    label: `${vehicle.registration}${vehicle.id === driver.suggestedVehicleId ? " · Assistant" : vehicle.id === driver.previousVehicleId ? " · yesterday" : ""}`,
    search: `${vehicle.registration} ${vehicle.fleetNumber || ""}`,
  }));
  const trailerOptions: SearchOption[] = data.trailers.map(trailer => ({
    id: trailer.id,
    label: `${trailer.trailerNumber}${trailer.type ? ` · ${trailer.type}` : ""}`,
    search: `${trailer.trailerNumber} ${trailer.type || ""}`,
  }));
  const runOptions: SearchOption[] = availableLoads.map(load => ({
    id: load.id,
    label: runOptionLabel(load, data.drivers),
    search: `${load.reference} ${load.rawReference} ${compactRun(load)} ${load.stops.map(stop => stop.name).join(" ")}`,
  }));

  useEffect(() => {
    const load = data.loads.find(item => item.id === driver.assignedLoadId);
    setLoadId(load?.id || "");
    setVehicleId(load?.vehicleId || driver.previousVehicleId || "");
    setTrailerId(load?.trailerId || "");
  }, [data.loads, driver.assignedLoadId, driver.previousVehicleId]);

  async function persistAllocation(nextLoadId: string, nextVehicleId: string, nextTrailerId: string, success = "Autosaved") {
    if (readOnly || driver.onLeave || !nextLoadId) return;
    setBusy(true); setNotice(undefined);
    try {
      const access = await token();
      const previous = data.loads.find(load => load.id === driver.assignedLoadId);
      if (previous && previous.id !== nextLoadId)
        await allocateRun(previous.id, { vehicleId: previous.vehicleId, trailerId: previous.trailerId }, access);
      await allocateRun(nextLoadId, { driverId: driver.driverId, vehicleId: nextVehicleId || undefined, trailerId: nextTrailerId || undefined }, access);
      setNotice(success);
      await refresh();
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : "Allocation autosave failed. Refresh Dispatch and try again.");
    } finally { setBusy(false); }
  }

  async function applySuggestion() {
    if (readOnly || driver.onLeave) return;
    const nextLoadId = driver.suggestedRunId || loadId;
    const nextVehicleId = driver.suggestedVehicleId || vehicleId;
    const nextTrailerId = suggestedLoad?.trailerId || trailerId;
    if (!nextLoadId) { setNotice("The Assistant has a vehicle suggestion but no unallocated run to apply."); return; }
    setLoadId(nextLoadId);
    setVehicleId(nextVehicleId);
    setTrailerId(nextTrailerId);
    await persistAllocation(nextLoadId, nextVehicleId, nextTrailerId, suggestedLoad ? `Autosaved · ${suggestionRunLabel(suggestedLoad)}` : "Assistant vehicle autosaved");
  }

  function chooseRun(value: string) {
    setLoadId(value);
    if (value) void persistAllocation(value, vehicleId, trailerId);
  }
  function chooseVehicle(value: string) {
    setVehicleId(value);
    if (loadId) void persistAllocation(loadId, value, trailerId);
  }
  function chooseTrailer(value: string) {
    setTrailerId(value);
    if (loadId) void persistAllocation(loadId, vehicleId, value);
  }

  async function prepareDispatch() {
    if (!loadId || !vehicleId) { setNotice("Choose a run and vehicle first."); return; }
    if (driver.onLeave) { setNotice("Driver is marked away in Sage HR."); return; }
    setBusy(true); setNotice(undefined);
    try {
      const access = await token();
      await allocateRun(loadId, { driverId: driver.driverId, vehicleId, trailerId: trailerId || undefined }, access);
      const route = await api.route(loadId, access);
      const minutes = routeMinutes(route);
      if (!minutes) throw new Error("The route did not return a driving time. Check the run's mapped stops before dispatch.");

      let readiness = await request<DispatchReadiness>(`/api/v1/loads/${encodeURIComponent(loadId)}/dispatch-readiness`, access, {
        method: "POST", body: JSON.stringify({ routeDrivingMinutes: minutes, acknowledgeUnverified: false }),
      }, 90000);
      let acknowledged = false;
      if (!readiness.canDispatch && readiness.structuralReadiness?.classification === "Unverified" && readiness.structuralReadiness.requiresAcknowledgement) {
        const warnings = readiness.structuralReadiness.checks.filter(check => !check.passed).map(check => `• ${check.message}`).join("\n");
        if (!window.confirm(`Pre-dispatch warnings:\n\n${warnings}\n\nAcknowledge and continue?`)) throw new Error("Dispatch cancelled; warnings were not acknowledged.");
        acknowledged = true;
        readiness = await request<DispatchReadiness>(`/api/v1/loads/${encodeURIComponent(loadId)}/dispatch-readiness`, access, {
          method: "POST", body: JSON.stringify({ routeDrivingMinutes: minutes, acknowledgeUnverified: true }),
        }, 90000);
      }
      if (!readiness.canDispatch) throw new Error(readiness.explanation || "Dispatch readiness did not pass.");

      const dispatch = await api.dispatch(loadId, access);
      const latest = data.loads.find(load => load.id === loadId) || selected;
      if (!latest) throw new Error("Run details could not be loaded for the text preview.");
      openMessage({ load: latest, mode: "dispatch", text: buildDriverText(latest, dispatch), routeMinutes: minutes, acknowledgeUnverified: acknowledged });
    } catch (exception) { setNotice(exception instanceof Error ? exception.message : "Dispatch could not be prepared."); }
    finally { setBusy(false); }
  }

  async function prepareUpdate() {
    if (!selected) return;
    setBusy(true); setNotice(undefined);
    try {
      const dispatch = await api.dispatch(selected.id, await token());
      openMessage({ load: selected, mode: "update", text: `Update for ${selected.reference}\n\n${buildDriverText(selected, dispatch)}\n\nUPDATE: ` });
    } catch (exception) { setNotice(exception instanceof Error ? exception.message : "Text update could not be prepared."); }
    finally { setBusy(false); }
  }

  return <>
    {showGroup && <tr className="dispatch-group"><td colSpan={11}>{driver.driverType === "Agency" ? "AGENCY · CURRENT / RECENT / ROSTERED" : driver.driverType === "Casual" ? "CASUAL · ZERO-HOURS EMPLOYED" : "EMPLOYED"}</td></tr>}
    <tr className={driver.onLeave ? "on-leave" : ""}>
      <td><strong>{driver.displayName}</strong><small>{driver.employeeNumber}</small>{driver.onLeave && <em>{driver.leaveType || "Sage HR leave"}</em>}{driver.agencyBookedThrough && <small>Booked to {new Date(`${driver.agencyBookedThrough}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" })}</small>}</td>
      <td><div className="badge-line"><span className={`driver-type type-${driver.driverType.toLowerCase()}`} title={driver.agencyName || driver.driverType}>{typeLetter(driver.driverType)}</span>{skillBadges(driver.skills).map(skill => <span className="skill-badge" key={skill}>{skill}</span>)}</div><small title={driver.agencyName}>{driver.driverType === "Agency" ? driver.agencyName || "Agency" : driver.driverGroup || ""}</small></td>
      <td><span className={`code-badge code-${driver.coding || "x"}`} title={driver.coding === "1" ? "Can do anything" : driver.coding === "2" ? "Established driver" : driver.coding === "3" ? "Newer driver · straightforward work" : driver.coding === "4" ? "Agency" : "Allocation code not set"}>{driver.coding || "—"}</span></td>
      <td><span className={`day-bubble ${driver.dayNumber >= 6 ? "high" : driver.dayNumber >= 5 ? "watch" : ""}`}>{driver.dayNumber}</span></td>
      <td><PreviousRouteHover driver={driver} /></td>
      <td><TypeaheadSelect disabled={readOnly || driver.onLeave || busy} value={vehicleId} onChange={chooseVehicle} options={vehicleOptions} placeholder="Type vehicle…" listId={`vehicle-${driver.driverId}`} />{driver.previousVehicleRegistration && <small>Yesterday: {driver.previousVehicleRegistration}</small>}</td>
      <td><TypeaheadSelect disabled={readOnly || driver.onLeave || busy} value={trailerId} onChange={chooseTrailer} options={trailerOptions} placeholder="Type trailer…" listId={`trailer-${driver.driverId}`} /></td>
      <td><div className="run-cell"><TypeaheadSelect disabled={readOnly || driver.onLeave || busy} value={loadId} onChange={chooseRun} options={runOptions} placeholder="Type run…" listId={`run-${driver.driverId}`} />{selected && <RunHover load={selected} />}</div></td>
      <td><span className="first-collection-time">{firstCollectionTime(selected) || "TBC"}</span>{firstCollection && <small>{cleanStopName(firstCollection.name)}</small>}</td>
      <td className="assistant-cell"><span>{driver.suggestion || (driver.previousFinalStop ? `Yesterday finished ${cleanStopName(driver.previousFinalStop)}.` : "Available for allocation.")}</span>{driver.assistantScore != null && driver.assistantScore > 0 && <small>Match score: {driver.assistantScore}</small>}{!readOnly && !driver.onLeave && (driver.suggestedRunId || driver.suggestedVehicleId) && <button className="assistant-use" type="button" disabled={busy} onClick={() => void applySuggestion()}>Use {suggestedLoad ? suggestionRunLabel(suggestedLoad) : "suggested vehicle"}</button>}</td>
      <td><div className="dispatch-buttons">{readOnly ? <>{selected && <Link to={`/timeline/run/${selected.id}`}>Timeline</Link>}</> : <><span className="autosave-state">Autosave</span><button className="primary" type="button" onClick={() => void prepareDispatch()} disabled={busy || driver.onLeave}>{busy ? "Working…" : "Dispatch"}</button>{selected && ["Dispatched", "InProgress"].includes(selected.status) && <button type="button" onClick={() => void prepareUpdate()} disabled={busy}>Plain text update</button>}{selected && <Link to={`/timeline/run/${selected.id}`}>Timeline</Link>}</>}</div>{notice && <small className="row-notice">{notice}</small>}</td>
    </tr>
  </>;
}

function RunHover({ load }: { load: DispatchLoad }) {
  return <span className="run-hover" tabIndex={0}><b>{compactRun(load)}</b><span className="run-popover"><strong>{load.southbound ? "Southbound · " : ""}{load.reference}</strong><small>{load.palletSpacesUsed ?? "—"}{load.totalPalletSpaces ? ` / ${load.totalPalletSpaces}` : ""} {load.capacityType || "load units"}</small>{load.stops.map(stop => <span key={stop.id}>{stop.sequence}. {stop.name}{stop.plannedArrivalUtc ? ` · ${new Date(stop.plannedArrivalUtc).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>)}{load.plannerNotes && <em>{load.plannerNotes}</em>}</span></span>;
}

function MessageDialog({ state, token, close, sent }: { state: MessageState; token: () => Promise<string>; close: () => void; sent: () => Promise<void> }) {
  const [text, setText] = useState(state.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function send() {
    setBusy(true); setError(undefined);
    try {
      await request(`/api/v1/loads/${encodeURIComponent(state.load.id)}/driver-message/sms`, await token(), {
        method: "POST",
        body: JSON.stringify({ message: text, dispatch: state.mode === "dispatch", routeDrivingMinutes: state.routeMinutes, acknowledgeUnverified: state.acknowledgeUnverified || false }),
      }, 90000);
      await sent();
    } catch (exception) { setError(exception instanceof Error ? exception.message : "Driver text could not be sent."); }
    finally { setBusy(false); }
  }
  return <div className="dispatch-modal-backdrop" role="dialog" aria-modal="true" aria-label="Driver text preview"><div className="dispatch-modal"><div className="title-row"><div><p className="eyebrow">{state.mode === "dispatch" ? "Dispatch text preview" : "Plain text update"}</p><h2>{state.load.reference}</h2></div><button type="button" onClick={close} disabled={busy}>Close</button></div><textarea rows={18} value={text} onChange={event => setText(event.target.value)} />{error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{error}</p>}<div className="dispatch-modal-actions"><button type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" type="button" onClick={() => void send()} disabled={busy || !text.trim()}>{busy ? "Sending…" : state.mode === "dispatch" ? "Dispatch & send text" : "Send plain text update"}</button></div></div></div>;
}