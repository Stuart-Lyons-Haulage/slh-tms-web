import { useCallback, useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type Day = {
  date: string; worked: boolean; sageMatched: boolean; nightOut: boolean; status: string; discrepancies: string[];
  tms: { runCount: number; runs: string[]; plannedStartUtc?: string; plannedEndUtc?: string; plannedMinutes?: number };
  tacho: { matched: boolean; dutyStartUtc?: string; dutyEndUtc?: string; totalMinutes?: number; vehicles: string[]; driveMinutes: number; restMinutes: number };
  dot: { movementEvents: number; firstMovementUtc?: string; lastMovementUtc?: string; movementSpanMinutes?: number; vehicles: string[] };
};
type DriverWeek = {
  driverId: string; driverName: string; employeeNumber: string; tachoName?: string; sageMatched: boolean; sageEmployeeId?: number;
  daysWorked: number; nightsOut: number; plannedMinutes: number; tachoMinutes: number; discrepancyCount: number; weeklyStatus: string; days: Day[];
};
type Report = {
  weekStart: string; weekEnd: string; generatedAtUtc: string;
  sourceStatus: { tms: string; dot: string; tachoMaster: string; sageHr: string };
  summary: { liveDrivers: number; totalDaysWorked: number; totalNightsOut: number; driversWithDiscrepancies: number; discrepancyCount: number };
  drivers: DriverWeek[];
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const monday = () => { const d = new Date(); const day = (d.getDay()+6)%7; d.setDate(d.getDate()-day); return iso(d); };
const fmtDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day:"2-digit", month:"2-digit", year:"numeric" }).format(new Date(`${value}T12:00:00`));
const fmtTime = (value?: string) => value ? new Intl.DateTimeFormat("en-GB", { hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value)) : "—";
const mins = (value?: number) => value == null ? "—" : `${Math.floor(value/60)}h ${String(value%60).padStart(2,"0")}m`;
const statusMark = (value: string) => value === "Confirmed" ? "✓" : value === "Review" ? "⚠" : value === "Check" ? "△" : "—";

export function NightOutReport() {
  const token = useAccessToken();
  const [weekStart,setWeekStart] = useState(monday());
  const [filter,setFilter] = useState<"all"|"review"|"nights">("all");
  const [openDriver,setOpenDriver] = useState<string>();
  const report = useApi(useCallback(async () => request<Report>(`/api/v1/driver-timesheets/weekly?weekStart=${weekStart}`, await token(), undefined, 60000), [weekStart,token]));

  const drivers = useMemo(() => (report.data?.drivers || []).filter(driver =>
    filter === "review" ? driver.discrepancyCount > 0 : filter === "nights" ? driver.nightsOut > 0 : true
  ), [filter, report.data]);

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Payroll & driver-hours control</p>
        <h1>Weekly driver timesheets & night outs</h1>
        <p className="intro">One weekly view reconciling the TMS plan, Tachomaster duties, DOT vehicle movement and the active Sage HR roster. It confirms days worked and nights out, then highlights anything that does not agree before payroll is processed.</p>
      </div>
    </div>

    <div className="panel" style={{ display:"flex", gap:12, alignItems:"end", flexWrap:"wrap" }}>
      <label>Week commencing<input type="date" value={weekStart} onChange={e=>setWeekStart(e.target.value)}/></label>
      <label>Show<select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}><option value="all">All live drivers</option><option value="review">Discrepancies only</option><option value="nights">Night outs only</option></select></label>
      <button className="primary" onClick={()=>void report.refresh()}>Refresh all sources</button>
      {report.data && <small>{fmtDate(report.data.weekStart)} to {fmtDate(report.data.weekEnd)}</small>}
    </div>

    {report.error && <p className="notice">{report.error}</p>}
    {report.loading && <div className="state">Reconciling TMS, Tachomaster, DOT and Sage HR…</div>}

    {report.data && <>
      <div className="metrics">
        <article className="metric"><span>Live drivers worked</span><strong>{report.data.summary.liveDrivers}</strong><small>Evidence from one or more operational sources</small></article>
        <article className="metric"><span>Days worked</span><strong>{report.data.summary.totalDaysWorked}</strong><small>Weekly total across live drivers</small></article>
        <article className="metric"><span>Nights out</span><strong>{report.data.summary.totalNightsOut}</strong><small>Planner-confirmed nights</small></article>
        <article className="metric"><span>Drivers to review</span><strong>{report.data.summary.driversWithDiscrepancies}</strong><small>{report.data.summary.discrepancyCount} discrepancy flag{report.data.summary.discrepancyCount===1?"":"s"}</small></article>
      </div>

      <div className="panel">
        <h2>Source confidence</h2>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:10 }}>
          <div><strong>TMS</strong><br/><small>{report.data.sourceStatus.tms}</small></div>
          <div><strong>Tachomaster</strong><br/><small>{report.data.sourceStatus.tachoMaster}</small></div>
          <div><strong>DOT / Falcon</strong><br/><small>{report.data.sourceStatus.dot}</small></div>
          <div><strong>Sage HR</strong><br/><small>{report.data.sourceStatus.sageHr}</small></div>
        </div>
      </div>

      <div className="panel" style={{ overflowX:"auto" }}>
        <table>
          <thead><tr><th>Driver</th><th>Sage</th><th>Days worked</th><th>Nights out</th><th>TMS planned</th><th>Tacho recorded</th><th>Discrepancies</th><th>Status</th><th></th></tr></thead>
          <tbody>{drivers.map(driver => <>
            <tr key={driver.driverId}>
              <td><strong>{driver.driverName}</strong><br/><small>{driver.employeeNumber}{driver.tachoName ? ` · Tacho: ${driver.tachoName}` : ""}</small></td>
              <td>{driver.sageMatched ? "✓ Matched" : "⚠ Not matched"}</td>
              <td><strong>{driver.daysWorked}</strong></td>
              <td><strong>{driver.nightsOut}</strong></td>
              <td>{mins(driver.plannedMinutes)}</td>
              <td>{mins(driver.tachoMinutes)}</td>
              <td>{driver.discrepancyCount}</td>
              <td><strong>{statusMark(driver.weeklyStatus)} {driver.weeklyStatus}</strong></td>
              <td><button onClick={()=>setOpenDriver(openDriver===driver.driverId ? undefined : driver.driverId)}>{openDriver===driver.driverId ? "Hide" : "View week"}</button></td>
            </tr>
            {openDriver===driver.driverId && <tr key={`${driver.driverId}-detail`}><td colSpan={9} style={{ padding:0 }}>
              <div style={{ padding:14, background:"#f7fafb", overflowX:"auto" }}>
                <table>
                  <thead><tr><th>Date</th><th>Worked</th><th>TMS runs</th><th>TMS span</th><th>Tacho duty</th><th>DOT movement</th><th>Night out</th><th>Checks</th></tr></thead>
                  <tbody>{driver.days.map(day => <tr key={day.date}>
                    <td><strong>{fmtDate(day.date)}</strong></td>
                    <td>{day.worked ? "Yes" : "No"}</td>
                    <td>{day.tms.runs.length ? day.tms.runs.join(", ") : "—"}</td>
                    <td>{day.tms.runCount ? `${fmtTime(day.tms.plannedStartUtc)} to ${fmtTime(day.tms.plannedEndUtc)} · ${mins(day.tms.plannedMinutes)}` : "—"}</td>
                    <td>{day.tacho.matched ? `${fmtTime(day.tacho.dutyStartUtc)} to ${fmtTime(day.tacho.dutyEndUtc)} · ${mins(day.tacho.totalMinutes)}` : "—"}</td>
                    <td>{day.dot.movementEvents ? `${fmtTime(day.dot.firstMovementUtc)} to ${fmtTime(day.dot.lastMovementUtc)} · ${day.dot.movementEvents} events` : "—"}</td>
                    <td>{day.nightOut ? <strong>Yes</strong> : "No"}</td>
                    <td>{day.discrepancies.length ? <div>{day.discrepancies.map((item,i)=><div key={i} style={{ marginBottom:4 }}>⚠ {item}</div>)}</div> : <span>✓ Confirmed</span>}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </td></tr>}
          </>)}</tbody>
        </table>
        {!report.loading && drivers.length===0 && <p>No drivers match this view for the selected week.</p>}
      </div>
    </>}
  </section>;
}
