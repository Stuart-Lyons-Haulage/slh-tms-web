import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { request, type Trailer, type Vehicle } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../driver-dispatch.css";
import { getRunDispatch, getRunRoute } from '../api/runs';

type DispatchDriver = {
  driverId: string;
  employeeNumber: string;
  displayName: string;
  driverType: "Employed" | "Casual" | "Agency";
  driverGroup?: string;
  skills?: string;
  coding?: string;
  agencyName?: string;
  dayNumber: number;
  previousFinalStop?: string;
  previousRoute?: string;
  previousRunReference?: string;
  previousVehicleRegistration?: string;
  suggestedRunReference?: string;
  suggestedVehicleRegistration?: string;
  suggestion?: string;
  assistantScore?: number;
  assignedLoadId?: string;
};

type DispatchLoad = {
  id: string;
  reference: string;
  rawReference: string;
  planningDate: string;
  status: string;
  southbound?: boolean;
  vehicleId?: string;
  driverId?: string;
  trailerId?: string;
  stops: Array<{ id: string; sequence: number; name: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string }>;
};

type Workbench = {
  planningDate: string;
  drivers: DispatchDriver[];
  loads: DispatchLoad[];
  vehicles: Vehicle[];
  trailers: Trailer[];
};

type AddDriverResponse = { message?: string };
type MessageState = { kind: "success" | "error"; text: string };
type DriverForm = { displayName: string; employeeNumber: string; driverType: "Employed" | "Casual" | "Agency"; agencyName: string; startDate: string; days: number };
type DispatchFilterKey = "driver" | "typeSkills" | "code" | "day" | "previous" | "vehicle" | "trailer" | "run" | "firstCollection" | "assistant" | "dispatch";
type DispatchFilters = Record<DispatchFilterKey, string>;

const dispatchFilterKeys: DispatchFilterKey[] = ["driver", "typeSkills", "code", "day", "previous", "vehicle", "trailer", "run", "firstCollection", "assistant", "dispatch"];
const dispatchFilterLabels: Record<DispatchFilterKey, string> = {
  driver: "Driver…",
  typeSkills: "Type / skills…",
  code: "Code…",
  day: "Day…",
  previous: "Previous…",
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
function today() { return isoDate(new Date()); }
const dispatchTimeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function localTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dispatchTimeFormatter.format(date);
}
function cleanStopName(value?: string) {
  return (value || "").replace(/^(?:Collect|Deliver)\s*[·:-]\s*/i, "").replace(/-/g, " ").trim();
}
function orderedStops(load?: DispatchLoad) { return [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence); }
// eslint-disable-next-line react-refresh/only-export-components
export function firstCollectionStop(load?: DispatchLoad) {
  const stops = orderedStops(load);
  return stops.find(stop => /^Collect\b/i.test(stop.name || "")) || stops[0];
}
function finalDestinationStop(load?: DispatchLoad) {
  const stops = orderedStops(load);
  return [...stops].reverse().find(stop => /^Deliver\b/i.test(stop.name || "")) || stops.at(-1);
}
// eslint-disable-next-line react-refresh/only-export-components
export function suggestionRunLabel(load?: DispatchLoad) {
  if (!load) return "—";
  const match = `${load.reference} ${load.rawReference}`.match(/\b(?:run\s*)?(\d{1,3})\b/i);
  const run = match?.[1] ? `Run ${Number(match[1])}` : load.reference;
  const destination = cleanStopName(finalDestinationStop(load)?.name);
  return destination ? `${run} ${destination}` : run;
}
// eslint-disable-next-line react-refresh/only-export-components
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
function firstCollectionTime(load?: DispatchLoad) {
  return localTime(firstCollectionStop(load)?.plannedArrivalUtc);
}

function TypeaheadSelect({ value, options, placeholder, onChange, disabled }: { value?: string; options: Array<{ value: string; label: string }>; placeholder: string; onChange: (value: string) => void; disabled?: boolean }) {
  const selected = options.find(option => option.value === value);
  const [query, setQuery] = useState(selected?.label || "");
  const [open, setOpen] = useState(false);
  useEffect(() => { setQuery(options.find(option => option.value === value)?.label || ""); }, [options, value]);
  const filtered = options.filter(option => !query.trim() || option.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12);
  function choose(option: { value: string; label: string }) { onChange(option.value); setQuery(option.label); setOpen(false); }
  return <div className="dispatch-typeahead">
    <input disabled={disabled} value={query} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); if (!event.target.value) onChange(""); }} />
    {open && !disabled && <div className="dispatch-typeahead-menu">{filtered.map(option => <button type="button" key={option.value} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>{option.label}</button>)}</div>}
  </div>;
}

export function DriverDispatch() {
  const token = useAccessToken();
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [date, setDate] = useState(initialParams.get("date") || today());
  const readOnly = false;
  const [data, setData] = useState<Workbench>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<MessageState>();
  const [showDriverTools, setShowDriverTools] = useState(false);
  const [driverToolBusy, setDriverToolBusy] = useState(false);
  const [driverToolNotice, setDriverToolNotice] = useState<string>();
  const [filters, setFilters] = useState<DispatchFilters>(() => emptyDispatchFilters());
  const [driverForm, setDriverForm] = useState<DriverForm>({ displayName: "", employeeNumber: "", driverType: "Agency", agencyName: "", startDate: date, days: 7 });

  const refresh = useCallback(async () => {
    setLoading(true); setError(undefined);
    try { setData(await request<Workbench>(`/api/v1/driver-dispatch?date=${encodeURIComponent(date)}`, await token(), undefined, 90000)); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "Driver Dispatch could not be loaded."); }
    finally { setLoading(false); }
  }, [date, token]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("date", date);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [date]);
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
      return dispatchFilterKeys.every(key => { const query = filters[key].trim().toLowerCase(); return !query || values[key].toLowerCase().includes(query); });
    });
  }, [data, filters]);

  async function syncDrivers() {
    if (readOnly) return;
    setDriverToolBusy(true); setDriverToolNotice(undefined);
    try { await request(`/api/v1/driver-master/tachomaster/sync`, await token(), { method: "POST" }, 180000); setDriverToolNotice("Driver Master sync completed. Dispatch has been refreshed."); await refresh(); }
    catch (exception) { setDriverToolNotice(exception instanceof Error ? exception.message : "Driver Master sync failed."); }
    finally { setDriverToolBusy(false); }
  }

  async function addDriver() {
    if (readOnly) return;
    if (!driverForm.displayName.trim()) { setDriverToolNotice("Enter the driver's name."); return; }
    if (driverForm.driverType === "Agency" && !driverForm.agencyName.trim()) { setDriverToolNotice("Enter the agency name."); return; }
    if (driverForm.driverType !== "Agency" && !driverForm.employeeNumber.trim()) { setDriverToolNotice("Enter the employee number, or use Sync Drivers first."); return; }
    setDriverToolBusy(true); setDriverToolNotice(undefined);
    try {
      const result = await request<AddDriverResponse>(`/api/v1/driver-dispatch/drivers`, await token(), { method: "POST", body: JSON.stringify({ displayName: driverForm.displayName.trim(), employeeNumber: driverForm.employeeNumber.trim() || null, driverType: driverForm.driverType, agencyName: driverForm.driverType === "Agency" ? driverForm.agencyName.trim() : null, startDate: driverForm.startDate, days: driverForm.driverType === "Agency" ? Number(driverForm.days) : null }) }, 90000);
      setDriverToolNotice(result.message || "Driver saved."); setDriverForm(current => ({ ...current, displayName: "", employeeNumber: "" })); await refresh();
    } catch (exception) { setDriverToolNotice(exception instanceof Error ? exception.message : "Driver could not be added."); }
    finally { setDriverToolBusy(false); }
  }

  async function saveAllocation(driver: DispatchDriver, field: "loadId" | "vehicleId" | "trailerId", value: string) {
    if (readOnly) return;
    const assigned = data?.loads.find(load => load.id === driver.assignedLoadId);
    const targetLoadId = field === "loadId" ? value : assigned?.id;
    if (!targetLoadId) return;
    try {
      await request(`/api/v1/driver-dispatch/${encodeURIComponent(targetLoadId)}/allocation`, await token(), { method: "PUT", body: JSON.stringify({ driverId: driver.driverId, vehicleId: field === "vehicleId" ? value || null : assigned?.vehicleId || null, trailerId: field === "trailerId" ? value || null : assigned?.trailerId || null }) }, 90000);
      setMessage({ kind: "success", text: "Allocation saved." }); await refresh();
    } catch (exception) { setMessage({ kind: "error", text: exception instanceof Error ? exception.message : "Allocation could not be saved." }); }
  }

  async function openDispatch(loadId: string) {
    try { const access = await token(); await Promise.all([getRunDispatch(loadId, access), getRunRoute(loadId, access)]); window.location.href = `/driver-dispatch/${encodeURIComponent(loadId)}`; }
    catch (exception) { setMessage({ kind: "error", text: exception instanceof Error ? exception.message : "Dispatch pack is unavailable." }); }
  }

  return <section className="driver-dispatch-page">
    <div className="title-row dispatch-title"><div><p className="eyebrow">Planning → allocation → route → driver text</p><h1>Driver Dispatch</h1><p className="hint">Allocate the driver, vehicle, trailer and run from one row. Changes autosave immediately; the first collection time comes from the run plan.</p></div><div className="title-actions dispatch-actions"><label>Planning date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><button type="button" onClick={() => void syncDrivers()} disabled={driverToolBusy}>{driverToolBusy ? "Working…" : "Sync Drivers"}</button><button type="button" onClick={() => { setShowDriverTools(value => !value); setDriverToolNotice(undefined); }}>{showDriverTools ? "Close driver add" : "Add Driver"}</button><button type="button" onClick={() => void refresh()} disabled={loading}>Refresh</button></div></div>

    {showDriverTools && <div className="dispatch-driver-tools"><div><strong>Add or roster a driver</strong></div><div className="dispatch-driver-form"><input placeholder="Driver name" value={driverForm.displayName} onChange={e => setDriverForm(v => ({ ...v, displayName: e.target.value }))}/><input placeholder="Employee number" value={driverForm.employeeNumber} onChange={e => setDriverForm(v => ({ ...v, employeeNumber: e.target.value }))}/><select value={driverForm.driverType} onChange={e => setDriverForm(v => ({ ...v, driverType: e.target.value as DriverForm["driverType"] }))}><option>Agency</option><option>Employed</option><option>Casual</option></select>{driverForm.driverType === "Agency" && <input placeholder="Agency" value={driverForm.agencyName} onChange={e => setDriverForm(v => ({ ...v, agencyName: e.target.value }))}/>}<button type="button" className="primary" onClick={() => void addDriver()} disabled={driverToolBusy}>Save driver</button></div>{driverToolNotice && <p className="hint">{driverToolNotice}</p>}</div>}

    {error && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}
    {message && <p className={`notice ${message.kind === "error" ? "error" : ""}`}>{message.text}</p>}
    {loading && <p className="state">Loading dispatch workbench…</p>}
    {data && <div className="table-wrap dispatch-table"><table><thead><tr>{dispatchFilterKeys.map(key => <th key={key}><input aria-label={dispatchFilterLabels[key]} placeholder={dispatchFilterLabels[key]} value={filters[key]} onChange={e => setFilters(current => ({ ...current, [key]: e.target.value }))}/></th>)}</tr></thead><tbody>{filteredDrivers.map(driver => {
      const assigned = data.loads.find(load => load.id === driver.assignedLoadId);
      return <tr key={driver.driverId}><td><strong>{driver.displayName}</strong><small>{driver.employeeNumber}</small></td><td>{driver.driverType}<small>{driver.skills || driver.agencyName || ""}</small></td><td>{driver.coding || "—"}</td><td>{driver.dayNumber}</td><td>{driver.previousRunReference || "—"}<small>{driver.previousFinalStop || driver.previousRoute || ""}</small></td><td><TypeaheadSelect value={assigned?.vehicleId} options={data.vehicles.map(item => ({ value: item.id, label: `${item.registration}${item.fleetNumber ? ` · ${item.fleetNumber}` : ""}` }))} placeholder="Vehicle…" onChange={value => void saveAllocation(driver, "vehicleId", value)} /></td><td><TypeaheadSelect value={assigned?.trailerId} options={data.trailers.map(item => ({ value: item.id, label: `${item.trailerNumber}${item.type ? ` · ${item.type}` : ""}` }))} placeholder="Trailer…" onChange={value => void saveAllocation(driver, "trailerId", value)} /></td><td><TypeaheadSelect value={assigned?.id} options={data.loads.map(item => ({ value: item.id, label: `${suggestionRunLabel(item)} · ${item.reference}` }))} placeholder="Run…" onChange={value => void saveAllocation(driver, "loadId", value)} /></td><td>{firstCollectionTime(assigned) || "—"}</td><td>{driver.suggestion || "—"}<small>{driver.assistantScore != null ? `Score ${driver.assistantScore}` : ""}</small></td><td>{assigned ? <><span className="status approved">{assigned.status}</span><button type="button" onClick={() => void openDispatch(assigned.id)}>Open dispatch</button></> : <span className="status pending">Unallocated</span>}</td></tr>;
    })}</tbody></table></div>}
    <p className="hint"><Link to="/planner">Back to Planner</Link></p>
  </section>;
}
