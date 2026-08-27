import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DriverAssignment } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import "../daily-allocation-viewer.css";

function iso(date: Date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function addDays(value: string, amount: number) { const [y,m,d]=value.split("-").map(Number); return iso(new Date(y,m-1,d+amount,12)); }
function label(value: string) { const [y,m,d]=value.split("-").map(Number); const date=new Date(y,m-1,d,12); return { day: String(d), weekday: date.toLocaleDateString("en-GB",{weekday:"short"}) }; }
function runLabel(value: string) { const match=value.match(/\b(?:run\s*)?(\d{1,3})\b/i); return match?.[1] || value; }

export function DailyAllocationViewer({ initialDate }: { initialDate: string }) {
  const token = useAccessToken();
  const [date,setDate] = useState(initialDate);
  const assignments = useApi(useCallback(async()=>api.driverAssignments(date,date,await token()),[date,token]));
  const days = useMemo(()=>[-3,-2,-1,0,1,2,3].map(offset=>addDays(date,offset)),[date]);
  const rows = [...(assignments.data || [])].sort((a,b)=>(a.driver?.displayName || "ZZZ").localeCompare(b.driver?.displayName || "ZZZ") || a.loadReference.localeCompare(b.loadReference));
  const allocated = rows.filter(row=>row.driver).length;

  return <section className="panel allocation-viewer">
    <div className="title-row"><div><p className="eyebrow">Read-only daily allocation</p><h2>Who was doing what?</h2><p className="hint">Choose a day to view the committed run record without opening the Planner or changing an allocation.</p></div><Link to={`/driver-dispatch?date=${encodeURIComponent(date)}`}>Open Driver Dispatch →</Link></div>
    <div className="allocation-day-strip">{days.map(item=>{const value=label(item);return <button type="button" key={item} className={item===date?"active":""} onClick={()=>setDate(item)}><small>{value.weekday}</small><strong>{value.day}</strong></button>;})}</div>
    {assignments.loading && !assignments.data && <div className="state">Loading allocations…</div>}
    {assignments.error && <p className="notice inline-notice">Daily allocation could not refresh: {assignments.error}</p>}
    {!assignments.loading && rows.length===0 && <p className="hint">No run records are available for this day.</p>}
    {rows.length>0 && <><div className="allocation-viewer-summary"><strong>{allocated}</strong> allocated driver/run record{allocated===1?"":"s"} · <strong>{rows.length}</strong> total run{rows.length===1?"":"s"}</div><div className="allocation-viewer-table-wrap"><table><thead><tr><th>Driver</th><th>Vehicle</th><th>Trailer</th><th>Run</th><th>Status</th><th>Final stop</th><th /></tr></thead><tbody>{rows.map((row:DriverAssignment)=><tr key={row.loadId}><td><strong>{row.driver?.displayName || "Unallocated"}</strong></td><td>{row.vehicle?.registration || "—"}</td><td>{row.trailerNumber || "—"}</td><td><span className="viewer-run">{runLabel(row.loadReference)}</span></td><td>{row.status}</td><td>{row.finalStop || "—"}</td><td><Link to={`/timeline/run/${row.loadId}`}>Timeline</Link></td></tr>)}</tbody></table></div></>}
  </section>;
}
