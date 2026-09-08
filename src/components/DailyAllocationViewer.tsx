import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { request, type Trailer, type Vehicle } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import "../daily-allocation-viewer.css";

type DispatchLoad = { id: string; reference: string; rawReference: string; driverId?: string; vehicleId?: string; trailerId?: string };
type DispatchDriver = { driverId: string; employeeNumber: string; displayName: string; driverType: "Employed" | "Casual" | "Agency"; driverGroup?: string; skills?: string; coding?: string; agencyName?: string; dayNumber: number; onLeave: boolean; leaveType?: string; assignedLoadId?: string; suggestion?: string; assistantScore?: number };
type Workbench = { planningDate: string; drivers: DispatchDriver[]; vehicles: Vehicle[]; trailers: Trailer[]; loads: DispatchLoad[] };
type DispatchStatus = "No Run" | "Awaiting Dispatch" | "Sent Awaiting Response" | "Confirmed";
type DriverDispatchStatus = { driverId: string; dispatchStatus: DispatchStatus; weeklyRestStatus: "Ready" | "DueSoon" | "Overdue" | "Unverified" | "Unknown"; weeklyRestMessage: string };
type DispatchMirror = { workbench: Workbench; statuses: Record<string, DriverDispatchStatus> };

function iso(date: Date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function addDays(value: string, amount: number) { const [y,m,d]=value.split("-").map(Number); return iso(new Date(y,m-1,d+amount,12)); }
function label(value: string) { const [y,m,d]=value.split("-").map(Number); const date=new Date(y,m-1,d,12); return { day: String(d), weekday: date.toLocaleDateString("en-GB",{weekday:"short"}) }; }
function runLabel(value: string) { const match=value.match(/\b(?:run\s*)?(\d{1,3})\b/i); return match?.[1] || value; }
function typeSkills(driver: DispatchDriver) { return [driver.driverType, driver.skills || driver.driverGroup || driver.agencyName].filter(Boolean).join(" · "); }
function effectiveStatus(driver: DispatchDriver, status?: DriverDispatchStatus): DispatchStatus {
  const assigned = Boolean(driver.assignedLoadId);
  if (assigned && status?.dispatchStatus === "No Run") return "Awaiting Dispatch";
  return status?.dispatchStatus || (assigned ? "Awaiting Dispatch" : "No Run");
}

export function DailyAllocationViewer({ initialDate }: { initialDate: string }) {
  const token = useAccessToken();
  const [date,setDate] = useState(initialDate);
  const mirror = useApi(useCallback(async(): Promise<DispatchMirror> => {
    const access = await token();
    const [workbench, statusResponse] = await Promise.all([
      request<Workbench>(`/api/v1/driver-dispatch?date=${encodeURIComponent(date)}`, access, undefined, 90000),
      request<{ planningDate: string; drivers: DriverDispatchStatus[] }>(`/api/v1/driver-dispatch-status?date=${encodeURIComponent(date)}`, access, undefined, 90000)
    ]);
    return { workbench, statuses: Object.fromEntries(statusResponse.drivers.map(item => [item.driverId, item])) };
  },[date,token]));
  const refreshMirror = mirror.refresh;
  const days = useMemo(()=>[-3,-2,-1,0,1,2,3].map(offset=>addDays(date,offset)),[date]);
  const data = mirror.data?.workbench;
  const statuses = mirror.data?.statuses || {};
  const rows = useMemo(() => [...(data?.drivers || [])].sort((a,b)=>a.driverType.localeCompare(b.driverType) || a.displayName.localeCompare(b.displayName)), [data?.drivers]);
  const allocated = rows.filter(row=>row.assignedLoadId).length;
  const unallocatedRuns = (data?.loads || []).filter(load=>!load.driverId).length;

  useEffect(() => {
    const interval = window.setInterval(() => void refreshMirror(), 10_000);
    const onFocus = () => void refreshMirror();
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshMirror(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshMirror]);

  return <section className="panel allocation-viewer">
    <div className="title-row"><div><p className="eyebrow">Read-only Driver Dispatch mirror</p><h2>Driver Dispatch</h2><p className="hint">This is the same driver, allocation and status data used by Driver Dispatch. Nothing can be changed from this Dashboard view.</p></div><Link to={`/driver-dispatch?date=${encodeURIComponent(date)}`}>Open Driver Dispatch →</Link></div>
    <div className="allocation-day-strip">{days.map(item=>{const value=label(item);return <button type="button" key={item} className={item===date?"active":""} onClick={()=>setDate(item)}><small>{value.weekday}</small><strong>{value.day}</strong></button>;})}</div>
    {mirror.loading && !mirror.data && <div className="state">Loading Driver Dispatch mirror…</div>}
    {mirror.error && <p className="notice inline-notice">Driver Dispatch mirror could not refresh: {mirror.error}</p>}
    {!mirror.loading && rows.length===0 && <p className="hint">No Driver Dispatch records are available for this day.</p>}
    {rows.length>0 && <><div className="allocation-viewer-summary"><strong>{allocated}</strong> drivers allocated · <strong>{rows.length}</strong> drivers shown · <strong>{unallocatedRuns}</strong> built run{unallocatedRuns===1?"":"s"} still unallocated</div><div className="allocation-viewer-table-wrap"><table><thead><tr><th>Driver</th><th>Type / skills</th><th>Code</th><th>Day</th><th>Vehicle</th><th>Trailer</th><th>Run</th><th>Assistant</th><th>Status</th></tr></thead><tbody>{rows.map(driver=>{
      const load = data?.loads.find(item=>item.id===driver.assignedLoadId);
      const vehicle = load?.vehicleId ? data?.vehicles.find(item=>item.id===load.vehicleId) : undefined;
      const trailer = load?.trailerId ? data?.trailers.find(item=>item.id===load.trailerId) : undefined;
      const status = statuses[driver.driverId];
      const dispatchStatus = effectiveStatus(driver,status);
      return <tr key={driver.driverId}><td><strong>{driver.displayName}</strong><small>{driver.employeeNumber}</small>{driver.onLeave && <small>{driver.leaveType || "Away"}</small>}</td><td>{typeSkills(driver)}</td><td>{driver.coding || "—"}</td><td>{driver.dayNumber}</td><td>{vehicle?.registration || "—"}</td><td>{trailer?.trailerNumber || "—"}</td><td>{load ? <span className="viewer-run">{runLabel(load.reference || load.rawReference)}</span> : "—"}</td><td>{driver.suggestion || "—"}{driver.assistantScore != null && driver.assistantScore > 0 ? <small>Match {driver.assistantScore}</small> : null}</td><td><strong>{dispatchStatus}</strong>{status?.weeklyRestStatus && status.weeklyRestStatus !== "Ready" && status.weeklyRestStatus !== "Unknown" ? <small title={status.weeklyRestMessage}>Tacho: {status.weeklyRestStatus === "Overdue" ? "Weekly rest due" : status.weeklyRestStatus === "Unverified" ? "Weekly rest unavailable" : "Rest due soon"}</small> : null}</td></tr>;
    })}</tbody></table></div></>}
  </section>;
}
