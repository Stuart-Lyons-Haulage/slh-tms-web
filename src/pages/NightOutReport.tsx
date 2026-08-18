import { useCallback, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type Row = { id: string; reference: string; planningDate: string; driverId?: string; driverName?: string; requested: boolean; finalStop?: string; status: string };
type Report = { from: string; to: string; rows: Row[]; counts: Array<{ driver: string; nights: number }> };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const startOfWeek = () => { const d = new Date(); const day = (d.getDay()+6)%7; d.setDate(d.getDate()-day); return iso(d); };
const fmt = (value: string) => new Intl.DateTimeFormat("en-GB", { day:"2-digit", month:"2-digit", year:"numeric" }).format(new Date(`${value}T12:00:00`));

export function NightOutReport() {
  const token = useAccessToken(); const [from,setFrom] = useState(startOfWeek()); const [to,setTo] = useState(iso(new Date()));
  const report = useApi(useCallback(async () => request<Report>(`/api/v1/planning-intelligence/night-outs?from=${from}&to=${to}`, await token()), [from,to,token]));
  return <section>
    <div className="title-row"><div><p className="eyebrow">Payroll control</p><h1>Driver night outs</h1><p>Planner-confirmed nights out are recorded against the run and driver, with the final stop retained for payroll checking.</p></div></div>
    <div className="panel" style={{ display:"flex", gap:12, alignItems:"end", flexWrap:"wrap" }}><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button className="primary" onClick={()=>void report.refresh()}>Refresh</button></div>
    {report.error && <p className="notice">{report.error}</p>}
    <div className="metrics">{(report.data?.counts || []).map(x => <article key={x.driver}><span>{x.driver}</span><strong>{x.nights}</strong><small>night out{x.nights===1?"":"s"}</small></article>)}</div>
    <div className="panel" style={{ overflowX:"auto" }}><table><thead><tr><th>Date</th><th>Driver</th><th>Run</th><th>Night out</th><th>Final stop</th><th>Payroll status</th></tr></thead><tbody>{(report.data?.rows || []).map(row => <tr key={row.id}><td>{fmt(row.planningDate)}</td><td><strong>{row.driverName || "Unmatched driver"}</strong></td><td>{row.reference}</td><td>{row.requested ? "Yes" : "No"}</td><td>{row.finalStop || "—"}</td><td>{row.requested ? "Pay / validate" : "No payment"}</td></tr>)}</tbody></table>{!report.loading && !(report.data?.rows.length) && <p>No planner night-out confirmations in this period.</p>}</div>
  </section>;
}