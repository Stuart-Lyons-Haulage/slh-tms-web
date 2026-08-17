import { useCallback, useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { intelligenceApi } from '../lib/intelligenceApi';

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate()+1); return iso(d); };
const daysAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate()-days); return iso(d); };

export function AttentionCentre() {
  const token = useAccessToken(); const navigate = useNavigate(); const [date, setDate] = useState(iso(new Date()));
  const report = useApi(useCallback(async () => intelligenceApi.attention(date, await token()), [date, token]));
  const groups = useMemo(() => ({ high: report.data?.items.filter(x => x.severity === 'High') ?? [], medium: report.data?.items.filter(x => x.severity === 'Medium') ?? [], low: report.data?.items.filter(x => x.severity === 'Low') ?? [] }), [report.data]);
  return <section className="intel-page"><div className="intel-heading"><div><p className="eyebrow">Operations control</p><h1>Needs Attention</h1><p>One queue for work that needs a planner or manager decision.</p></div><label>Planning date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div>
    {report.loading && <div className="state">Checking operational exceptions…</div>}{report.error && <div className="state error">{report.error}</div>}
    {report.data && <><div className="intel-summary"><article className="bad"><span>High</span><strong>{groups.high.length}</strong></article><article className="warn-card"><span>Medium</span><strong>{groups.medium.length}</strong></article><article><span>Low</span><strong>{groups.low.length}</strong></article><article><span>Total</span><strong>{report.data.count}</strong></article></div>
      <div className="attention-list">{report.data.items.length === 0 ? <div className="state good-state">No current attention items for this date.</div> : report.data.items.map(item => <button key={item.id} className={`attention-row ${item.severity.toLowerCase()}`} onClick={() => navigate(item.href)}><span className="severity">{item.severity}</span><div><b>{item.title}</b><small>{item.detail}</small></div><span className="open-arrow">›</span></button>)}</div></>}
  </section>;
}

export function MorningReadiness() {
  const token = useAccessToken(); const [date, setDate] = useState(tomorrow());
  const report = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));
  const lock = async () => { if (!window.confirm(`Lock the operational baseline for ${date}? Changes will remain possible but require a reason.`)) return; await intelligenceApi.lockPlan(date, await token()); await report.refresh(); };
  return <section className="intel-page"><div className="intel-heading"><div><p className="eyebrow">Pre-operation gate</p><h1>Morning Readiness</h1><p>Is the plan ready to operate?</p></div><label>Planning date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div>
    {report.loading && <div className="state">Running readiness checks…</div>}{report.error && <div className="state error">{report.error}</div>}
    {report.data && <><div className={`readiness-banner ${report.data.ready ? 'ready' : 'not-ready'}`}><strong>{report.data.ready ? '✓ READY TO OPERATE' : '⚠ ACTION REQUIRED'}</strong><span>{report.data.runs} runs planned for {new Date(`${date}T12:00:00`).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</span></div>
      <div className="intel-summary readiness-grid"><Metric label="Runs" value={report.data.runs} ok={report.data.runs > 0}/><Metric label="Drivers allocated" value={`${report.data.assignedDrivers}/${report.data.runs}`} ok={report.data.missingAllocations===0}/><Metric label="Vehicles allocated" value={`${report.data.assignedVehicles}/${report.data.runs}`} ok={report.data.missingAllocations===0}/><Metric label="VOR conflicts" value={report.data.vorConflicts} ok={report.data.vorConflicts===0}/><Metric label="Tacho concerns" value={report.data.tachoConcerns} ok={report.data.tachoConcerns===0}/><Metric label="Geofence/map gaps" value={report.data.geofenceGaps} ok={report.data.geofenceGaps===0}/><Metric label="Unreviewed orders" value={report.data.unreviewedOrders} ok={report.data.unreviewedOrders===0}/><Metric label="Plan baseline" value={report.data.planLock ? 'Locked' : 'Open'} ok={!!report.data.planLock}/></div>
      <section className="lock-panel"><div><p className="eyebrow">Plan baseline</p><h2>{report.data.planLock ? `Locked ${new Date(report.data.planLock.lockedAtUtc).toLocaleString('en-GB')}` : 'Plan is still editable without change reasons'}</h2><p>{report.data.planLock ? `${report.data.planLock.baselineRuns} baseline runs. Any driver, vehicle, route or status change now requires a reason and is counted in Plan Stability.` : 'Lock the plan once the planner is satisfied. Emergency changes are still allowed and fully audited.'}</p></div>{!report.data.planLock && <button className="primary" onClick={lock}>Lock Plan</button>}</section></>}
  </section>;
}

function Metric({label,value,ok}:{label:string;value:string|number;ok:boolean}) { return <article className={ok?'good-card':'bad'}><span>{label}</span><strong>{value}</strong></article>; }

export function TimelinePage({ kind }: { kind: 'run' | 'order' }) {
  const { id = '' } = useParams(); const token = useAccessToken();
  const report = useApi(useCallback(async () => kind === 'run' ? intelligenceApi.runTimeline(id, await token()) : intelligenceApi.orderTimeline(id, await token()), [id, kind, token]));
  return <section className="intel-page"><div className="intel-heading"><div><p className="eyebrow">Audit timeline</p><h1>{report.data?.reference ?? (kind === 'run' ? 'Run timeline' : 'Order timeline')}</h1><p>{report.data ? `${report.data.entityType} · ${report.data.status}${report.data.planningDate ? ` · ${report.data.planningDate}` : ''}` : 'Loading complete operational history…'}</p></div><NavLink className="button-link" to={kind==='run'?'/loads':'/order-intake'}>Back to {kind==='run'?'Runs':'Orders'}</NavLink></div>
    {report.loading && <div className="state">Loading timeline…</div>}{report.error && <div className="state error">{report.error}</div>}
    {report.data && <div className="timeline">{report.data.events.length === 0 ? <div className="state">No timeline events recorded.</div> : report.data.events.map((event,index) => <article key={`${event.atUtc}-${index}`}><div className="timeline-dot"/><div className="timeline-time">{new Date(event.atUtc).toLocaleString('en-GB')}</div><div className="timeline-card"><span>{event.source}</span><h2>{event.title}</h2><p>{event.detail}</p>{event.by && <small>By {event.by}</small>}</div></article>)}</div>}
  </section>;
}

export function PlanStability() {
  const token = useAccessToken(); const [from,setFrom] = useState(daysAgo(29)); const [to,setTo] = useState(iso(new Date()));
  const report = useApi(useCallback(async () => intelligenceApi.stability(from,to,await token()),[from,to,token]));
  return <section className="intel-page"><div className="intel-heading"><div><p className="eyebrow">Management control</p><h1>Plan Stability</h1><p>How closely execution follows the locked operating plan.</p></div><div className="date-pair"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div></div>
    {report.loading&&<div className="state">Calculating plan stability…</div>}{report.error&&<div className="state error">{report.error}</div>}
    {report.data&&<div className="intel-summary"><article className="good-card"><span>Plan stability</span><strong>{report.data.stabilityPercent==null?'—':`${report.data.stabilityPercent.toFixed(1)}%`}</strong></article><article><span>Locked days</span><strong>{report.data.lockedDays}</strong></article><article><span>Baseline runs</span><strong>{report.data.baselineRuns}</strong></article><article><span>Changed runs</span><strong>{report.data.changedRuns}</strong></article><article><span>Driver swaps</span><strong>{report.data.driverSwaps}</strong></article><article><span>Vehicle swaps</span><strong>{report.data.vehicleSwaps}</strong></article><article><span>Route amendments</span><strong>{report.data.routeAmendments}</strong></article><article><span>Recorded changes</span><strong>{report.data.runChanges}</strong></article></div>}
  </section>;
}
