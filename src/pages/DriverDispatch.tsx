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
  assignedLoadId?: string;
  assignedRunCount: number;
  suggestedRunId?: string;
  suggestedRunReference?: string;
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
type DispatchFilterKey = "driver" | "typeSkills" | "code" | "day" | "vehicle" | "trailer" | "run" | "start" | "assistant" | "compliance" | "dispatch";
type DispatchFilters = Record<DispatchFilterKey, string>;
type SearchOption = { id: string; label: string; search?: string };

const dispatchFilterKeys: DispatchFilterKey[] = ["driver", "typeSkills", "code", "day", "vehicle", "trailer", "run", "start", "assistant", "compliance", "dispatch"];
const dispatchFilterPlaceholders: Record<DispatchFilterKey, string> = {
  driver: "Driver…",
  typeSkills: "Type / skill…",
  code: "Code…",
  day: "Day…",
  vehicle: "Vehicle…",
  trailer: "Trailer…",
  run: "Run…",
  start: "Start…",
  assistant: "Assistant…",
  compliance: "Compliance…",
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
function tomorrow() { const date = new Date(); date.setDate(date.getDate() + 1); return isoDate(date); }
function localTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function compactRun(load?: DispatchLoad) {
  if (!load) return "—";
  const match = `${load.reference} ${load.rawReference}`.match(/\b(?:run\s*)?(\d{1,3})\b/i);
  const core = match?.[1] || load.reference;
  return `${load.southbound ? "SB " : ""}${core}`;
}
function runOptionLabel(load: DispatchLoad, drivers: DispatchDriver[]) {
  const allocatedDriver = load.driverId ? drivers.find(driver => driver.driverId === load.driverId) : undefined;
  const allocation = load.driverId ? ` · allocated${allocatedDriver ? ` to ${allocatedDriver.displayName}` : ""}` : "";
  return `${compactRun(load)} · ${load.reference}${allocation}`;
}
function typeLetter(type: string) { return type === "Agency" ? "A" : type === "Casual" ? "C" : "E"; }
function skillBadges(value?: string) {
  return (value || "").split(/[,;|/]+/).map(item => item.trim()).filter(Boolean).slice(0, 5);
}
function dispatchState(driver: DispatchDriver) {
  if (driver.onLeave) return { className: "leave", label: driver.partDayLeave ? "PART DAY" : "LEAVE", title: driver.leaveType || "Sage HR leave" };
  if (!driver.tachoMasterDriverId && !driver.tachoCardNumber) return { className: "review", label: "REVIEW", title: "Canonical Tacho identity missing" };
  return { className: "ready", label: "READY", title: "Canonical Tacho identity available; live Tacho/hours compliance is rechecked at dispatch. Driving licence automation is currently paused." };
}
function routeMinutes(route: Record<string, unknown>) {
  const routes = route.routes as Array<{ summary?: { travelTimeInSeconds?: number } }> | undefined;
  const seconds = routes?.[0]?.summary?.travelTimeInSeconds;
  return typeof seconds === "number" && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : undefined;
}
function buildDriverText(load: DispatchLoad, dispatch: LoadDispatch, startTime: string) {
  const lines = [
    `SLH ${load.southbound ? "Southbound " : ""}${load.reference}`,
    dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : "",
    startTime ? `Start time: ${startTime}` : "",
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
  useEffect(() => { setText(selected?.label || ""); }, [value, selected?.label]);

  function resolve(next: string) {
    const query = next.trim().toLowerCase();
    if (!query) { setText(""); onChange(""); return; }
    const exact = options.find(option => option.label.toLowerCase() === query);
    const match = exact || options.find(option => `${option.label} ${option.search || ""}`.toLowerCase().includes(query));
    if (match) { setText(match.label); onChange(match.id); return; }
    setText(selected?.label || "");
  }

  return <div className="dispatch-typeahead">
    <input
      list={listId}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      onChange={event => {
        const next = event.target.value;
        setText(next);
        if (!next.trim()) onChange("");
        const exact = options.find(option => option.label.toLowerCase() === next.trim().toLowerCase());
        if (exact) onChange(exact.id);
      }}
      onBlur={() => resolve(text)}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); resolve(text); }
        if (event.key === "Escape") { setText(selected?.label || ""); }
      }}
    />
    <datalist id={listId}>{options.map(option => <option key={option.id} value={option.label} />)}</datalist>
  </div>;
}

export function DriverDispatch() {
  const token = useAccessToken();
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [date, setDate] = useState(initialParams.get("date") || tomorrow());
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
      const compliance = dispatchState(driver);
      const values: Record<DispatchFilterKey, string> = {
        driver: `${driver.displayName} ${driver.employeeNumber}`,
        typeSkills: `${driver.driverType} ${driver.driverGroup || ""} ${driver.skills || ""} ${driver.agencyName || ""}`,
        code: driver.coding || "",
        day: String(driver.dayNumber),
        vehicle: `${vehicle?.registration || ""} ${driver.previousVehicleRegistration || ""}`,
        trailer: `${trailer?.trailerNumber || ""} ${trailer?.type || ""}`,
        run: assigned ? `${compactRun(assigned)} ${assigned.reference} ${assigned.rawReference}` : "unallocated",
        start: localTime(assigned?.plannedStartUtc),
        assistant: `${driver.suggestion || ""} ${driver.previousFinalStop || ""}`,
        compliance: `${compliance.label} ${compliance.title}`,
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
        <p className="hint">{readOnly ? "Read-only comparison screen. Keep this beside today's plan." : "Allocate the driver, regular vehicle and trailer, set the start time, preview the run and dispatch from one row."}</p>
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
        <span><strong>{data.loads.length}</strong> planned runs</span>
        <span><strong>{data.drivers.filter(driver => driver.onLeave).length}</strong> away / leave</span>
        <span>Leave: <strong>{data.leaveSource}</strong></span>
        {data.weekStart && data.weekEnd && <span>Week: <strong>{new Date(`${data.weekStart}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" })} → {new Date(`${data.weekEnd}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" })}</strong></span>}
        {dispatchFilterKeys.some(key => filters[key]) && <button type="button" className="text-button clear-dispatch-filters" onClick={() => setFilters(emptyDispatchFilters())}>Clear filters</button>}
      </div>
      <div className="dispatch-table-wrap">
        <table className="dispatch-table">
          <thead>
            <tr><th>Driver</th><th>Type / skills</th><th>Code</th><th>Day</th><th>Vehicle</th><th>Trailer</th><th>Run</th><th>Start</th><th>Assistant</th><th>Compliance</th><th>Dispatch</th></tr>
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
      <p className="hint">Dispatch is a driver-only board: active Sage HR employees are admitted only when they match the configured Drivers team / Driver position. Casual drivers remain a separate zero-hours employed category. Agency is included when booked on the Wednesday–Tuesday roster, allocated today, used in the immediately previous planning week, or used on at least 3 days in the last 28 days. Vehicle, trailer and run boxes can be typed into or selected from their dropdown suggestions.</p>
    </>}

    {message && <MessageDialog state={message} token={token} close={() => setMessage(undefined)} sent={async () => { setMessage(undefined); await refresh(); }} />}
  </section>;
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
  const [startTime, setStartTime] = useState(localTime(initial?.plannedStartUtc));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const selected = data.loads.find(load => load.id === loadId);
  const compliance = dispatchState(driver);
  const availableLoads = data.loads;
  const vehicleOptions: SearchOption[] = data.vehicles.map(vehicle => ({
    id: vehicle.id,
    label: `${vehicle.registration}${vehicle.id === driver.previousVehicleId ? " · yesterday" : ""}`,
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
    setStartTime(localTime(load?.plannedStartUtc));
  }, [data.loads, driver.assignedLoadId, driver.previousVehicleId]);

  async function save() {
    if (readOnly || driver.onLeave) return;
    setBusy(true); setNotice(undefined);
    try {
      const access = await token();
      const previous = data.loads.find(load => load.id === driver.assignedLoadId);
      if (previous && previous.id !== loadId) {
        await api.allocateLoad(previous.id, { vehicleId: previous.vehicleId, trailerId: previous.trailerId }, access);
      }
      if (loadId) {
        await api.allocateLoad(loadId, { driverId: driver.driverId, vehicleId: vehicleId || undefined, trailerId: trailerId || undefined }, access);
        await request(`/api/v1/driver-dispatch/${encodeURIComponent(loadId)}/start-time`, access, { method: "PUT", body: JSON.stringify({ startTime: startTime || null }) });
      }
      setNotice("Saved");
      await refresh();
    } catch (exception) { setNotice(exception instanceof Error ? exception.message : "Allocation could not be saved."); }
    finally { setBusy(false); }
  }

  async function prepareDispatch() {
    if (!loadId || !vehicleId) { setNotice("Choose a run and vehicle first."); return; }
    if (!startTime) { setNotice("Enter the driver's start time first."); return; }
    if (driver.onLeave) { setNotice("Driver is marked away in Sage HR."); return; }
    setBusy(true); setNotice(undefined);
    try {
      const access = await token();
      await api.allocateLoad(loadId, { driverId: driver.driverId, vehicleId, trailerId: trailerId || undefined }, access);
      await request(`/api/v1/driver-dispatch/${encodeURIComponent(loadId)}/start-time`, access, { method: "PUT", body: JSON.stringify({ startTime }) });
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
      openMessage({ load: latest, mode: "dispatch", text: buildDriverText(latest, dispatch, startTime), routeMinutes: minutes, acknowledgeUnverified: acknowledged });
    } catch (exception) { setNotice(exception instanceof Error ? exception.message : "Dispatch could not be prepared."); }
    finally { setBusy(false); }
  }

  async function prepareUpdate() {
    if (!selected) return;
    setBusy(true); setNotice(undefined);
    try {
      const dispatch = await api.dispatch(selected.id, await token());
      openMessage({ load: selected, mode: "update", text: `Update for ${selected.reference}\n\n${buildDriverText(selected, dispatch, startTime)}\n\nUPDATE: ` });
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
      <td><TypeaheadSelect disabled={readOnly || driver.onLeave} value={vehicleId} onChange={setVehicleId} options={vehicleOptions} placeholder="Type vehicle…" listId={`vehicle-${driver.driverId}`} />{driver.previousVehicleRegistration && <small>Yesterday: {driver.previousVehicleRegistration}</small>}</td>
      <td><TypeaheadSelect disabled={readOnly || driver.onLeave} value={trailerId} onChange={setTrailerId} options={trailerOptions} placeholder="Type trailer…" listId={`trailer-${driver.driverId}`} /></td>
      <td><div className="run-cell"><TypeaheadSelect disabled={readOnly || driver.onLeave} value={loadId} onChange={setLoadId} options={runOptions} placeholder="Type run…" listId={`run-${driver.driverId}`} />{selected && <RunHover load={selected} />}{!selected && driver.suggestedRunId && <button className="text-button" type="button" disabled={readOnly || driver.onLeave} onClick={() => setLoadId(driver.suggestedRunId || "")}>Use {driver.suggestedRunReference || "suggested SB"}</button>}</div></td>
      <td><input type="time" value={startTime} disabled={readOnly || driver.onLeave} onChange={event => setStartTime(event.target.value)} /></td>
      <td className="assistant-cell"><span>{driver.suggestion || (driver.previousFinalStop ? `Yesterday finished ${driver.previousFinalStop}.` : "Available for allocation.")}</span></td>
      <td><span className={`compliance-pill ${compliance.className}`} title={compliance.title}>{compliance.label}</span></td>
      <td><div className="dispatch-buttons">{readOnly ? <>{selected && <Link to={`/timeline/run/${selected.id}`}>Timeline</Link>}</> : <><button type="button" onClick={() => void save()} disabled={busy || driver.onLeave}>{busy ? "Working…" : "Save"}</button><button className="primary" type="button" onClick={() => void prepareDispatch()} disabled={busy || driver.onLeave}>Dispatch</button>{selected && ["Dispatched", "InProgress"].includes(selected.status) && <button type="button" onClick={() => void prepareUpdate()} disabled={busy}>Plain text update</button>}{selected && <Link to={`/timeline/run/${selected.id}`}>Timeline</Link>}</>}</div>{notice && <small className="row-notice">{notice}</small>}</td>
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