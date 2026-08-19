import { useCallback, useEffect, useMemo, useState } from "react";
import { api, request, type Load, type Site } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../simple-planner.css";

type Period = "" | "AM" | "PM";
type Allocation = { loadId: string; loadReference?: string; pallets: number };
type PlanningOrder = { id: string; reference: string; customerCode: string; orderedPallets: number; plannedPallets: number; outstandingPallets: number; collection: string; destination: string; allocations: Allocation[] };
type PlanningControlData = { date: string; generatedAtUtc: string; orders: PlanningOrder[]; summary: { ordered: number; planned: number; outstanding: number } };
type RunLine = { key: string; orderId?: string; collectionSite: string; deliverySite: string; pallets: string };
type RunDraft = { key: string; loadId?: string; period: Period; lines: RunLine[] };

const blankLine = (): RunLine => ({ key: crypto.randomUUID(), collectionSite: "", deliverySite: "", pallets: "" });
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const normalise = (v: unknown) => String(v ?? "").trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
const tagged = (notes: string | undefined, label: string) => (notes || "").split("·").map(x=>x.trim()).find(x=>x.toLowerCase().startsWith(`${label}:`.toLowerCase()))?.slice(label.length+1).trim() || "";
const periodFromLoad = (load: Load): Period => { const p = tagged(load.plannerNotes,"Planner period").toUpperCase(); return p === "AM" || p === "PM" ? p : ""; };
const siteAddress = (sites: Site[], value: string) => sites.find(site => [site.name,site.driverTextName,site.externalCode,...(site.aliases||"").split(/[,;|]/)].some(x=>normalise(x)===normalise(value)))?.collectionAddress;
const runRef = (date: string, n: number) => `RUN-${date.replaceAll("-","")}-${String(n).padStart(2,"0")}`;

export function RunPlannerLive() {
  const token = useAccessToken();
  const [date,setDate] = useState(localDate());
  const [control,setControl] = useState<PlanningControlData>();
  const [loads,setLoads] = useState<Load[]>([]);
  const [sites,setSites] = useState<Site[]>([]);
  const [runs,setRuns] = useState<RunDraft[]>([{ key: `shell-${localDate()}-1`, period:"", lines:[blankLine()] }]);
  const [activeKey,setActiveKey] = useState(runs[0].key);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState<string>();
  const [query,setQuery] = useState("");

  const refresh = useCallback(async () => {
    const access = await token();
    const [nextControl,nextLoads,nextSites] = await Promise.all([
      request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}&_=${Date.now()}`, access),
      api.loads(date,access), api.sites(access),
    ]);
    setControl(nextControl); setLoads(Array.isArray(nextLoads)?nextLoads:[]); setSites(Array.isArray(nextSites)?nextSites:[]);
  },[date,token]);

  // Do not poll while a planner is building a run. Polling rebuilt the run from saved server
  // allocations every few seconds and wiped locally-selected orders before Save Run was pressed.
  // Pallet Control maintains its own live refresh; this planner refreshes on load/date change,
  // explicit Refresh, and immediately after a successful Save Run.
  useEffect(()=>{ void refresh(); },[refresh]);

  useEffect(()=>{
    if (!control) return;
    const ordered=[...loads].sort((a,b)=>String(a.reference).localeCompare(String(b.reference)));
    if (!ordered.length) {
      const shell: RunDraft={key:`shell-${date}-1`,period:"",lines:[blankLine()]}; setRuns([shell]); setActiveKey(shell.key); return;
    }
    const drafts=ordered.map(load=>{
      const lines=control.orders.flatMap(order=>{
        const allocation=order.allocations.find(a=>a.loadId===load.id && a.pallets>0);
        return allocation ? [{key:`${load.id}-${order.id}`,orderId:order.id,collectionSite:order.collection,deliverySite:order.destination,pallets:String(allocation.pallets)}] : [];
      });
      return {key:load.id,loadId:load.id,period:periodFromLoad(load),lines:lines.length?lines:[blankLine()]} satisfies RunDraft;
    });
    setRuns(drafts); setActiveKey(current=>drafts.some(r=>r.key===current)?current:drafts[0].key);
  },[control,date,loads]);

  const orders=useMemo(()=>control?.orders || [],[control]);
  const visible=useMemo(()=>orders.filter(o=>o.outstandingPallets>0).filter(o=>!query.trim() || [o.reference,o.customerCode,o.collection,o.destination].some(v=>String(v).toLowerCase().includes(query.toLowerCase()))),[orders,query]);
  const active=runs.find(r=>r.key===activeKey) || runs[0];
  const updateRun=(key:string,fn:(r:RunDraft)=>RunDraft)=>setRuns(current=>current.map(r=>r.key===key?fn(r):r));
  const updateLine=(runKey:string,lineKey:string,patch:Partial<RunLine>)=>updateRun(runKey,r=>({...r,lines:r.lines.map(l=>l.key===lineKey?{...l,...patch}:l)}));

  function addOrder(order: PlanningOrder) {
    if (!active) return;
    updateRun(active.key,run=>{
      if (run.lines.some(line=>line.orderId===order.id)) return run;
      const value:RunLine={key:crypto.randomUUID(),orderId:order.id,collectionSite:order.collection,deliverySite:order.destination,pallets:String(order.outstandingPallets)};
      const blank=run.lines.findIndex(l=>!l.orderId&&!l.collectionSite&&!l.deliverySite&&!l.pallets);
      if(blank>=0){const lines=[...run.lines];lines[blank]=value;return{...run,lines};}
      return{...run,lines:[...run.lines,value]};
    });
    setMessage(`${order.collection} → ${order.destination} added to this run. It remains in Orders to Plan until the run is saved.`);
  }

  async function allocate(orderId:string,loadId:string,pallets:number,access:string){
    return request(`/api/v1/planning-control/allocations`,access,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId,loadId,date,pallets,note:"Updated from live Run Planner"})});
  }

  async function saveRun(run:RunDraft,index:number){
    if(busy)return; setBusy(true); setMessage(undefined);
    try{
      if(!run.period) throw new Error(`Select AM or PM for Run ${index+1}.`);
      const used=run.lines.filter(l=>l.orderId||l.collectionSite||l.deliverySite||l.pallets);
      if(!used.length) throw new Error(`Run ${index+1} needs at least one order.`);
      const resolved=used.map(line=>{
        const order=line.orderId?orders.find(o=>o.id===line.orderId):orders.find(o=>normalise(o.collection)===normalise(line.collectionSite)&&normalise(o.destination)===normalise(line.deliverySite));
        const pallets=Number(line.pallets);
        if(!order) throw new Error(`${line.collectionSite} → ${line.deliverySite} does not resolve to one order.`);
        if(!Number.isInteger(pallets)||pallets<=0) throw new Error(`Enter a whole pallet quantity greater than zero.`);
        const existing=order.allocations.find(a=>a.loadId===run.loadId)?.pallets||0;
        const max=order.orderedPallets-Math.max(order.plannedPallets-existing,0);
        if(pallets>max) throw new Error(`${order.collection} → ${order.destination}: maximum available is ${max}.`);
        return{...line,orderId:order.id,pallets};
      });
      const access=await token();
      const stops=resolved.flatMap(line=>[
        {name:`Collect · ${line.collectionSite}`,address:siteAddress(sites,line.collectionSite)},
        {orderId:line.orderId,name:`Deliver · ${line.deliverySite}`,address:siteAddress(sites,line.deliverySite)},
      ]);
      let loadId=run.loadId;
      if(!loadId){const created=await api.createLoad({reference:runRef(date,index+1),planningDate:date,palletSpacesUsed:resolved.reduce((s,l)=>s+l.pallets,0),totalPalletSpaces:26,capacityType:"Standard pallets",plannerNotes:`Planner period: ${run.period}`,stops},access);loadId=created.id;}
      else await api.updateLoadStops(loadId,stops,access);
      const previous=orders.filter(o=>o.allocations.some(a=>a.loadId===loadId&&a.pallets>0)).map(o=>o.id);
      const currentIds=new Set(resolved.map(l=>l.orderId));
      for(const id of previous.filter(id=>!currentIds.has(id))) await allocate(id,loadId,0,access);
      for(const line of resolved) await allocate(line.orderId,loadId,line.pallets,access);
      await api.updateLoadStops(loadId,stops,access);
      await refresh();
      setMessage(`Run ${index+1} saved. Pallet Control and Orders to Plan have been recalculated.`);
    }catch(error){setMessage(error instanceof Error?error.message:"Run could not be saved.");}
    finally{setBusy(false);}
  }

  return <section className="stable-planner">
    <div className="planner-toolbar panel"><label>Plan date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button onClick={()=>void refresh()} disabled={busy}>Refresh</button><button className="primary" onClick={()=>{const draft:RunDraft={key:`shell-${date}-${crypto.randomUUID()}`,period:"",lines:[blankLine()]};setRuns(r=>[...r,draft]);setActiveKey(draft.key);}}>+ Add run</button></div>
    {message&&<p className="notice inline-notice">{message}</p>}
    <div className="simple-planner-grid">
      <div className="simple-runs">
        {runs.map((run,index)=><article key={run.key} className={`panel ${activeKey===run.key?"selected":""}`} onClick={()=>setActiveKey(run.key)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}><h2>Run {index+1}</h2><select value={run.period} onChange={e=>updateRun(run.key,r=>({...r,period:e.target.value as Period}))}><option value="">AM / PM</option><option value="AM">AM</option><option value="PM">PM</option></select></div>
          <div className="table-wrap"><table><thead><tr><th>Collection</th><th>Delivery</th><th>Pallets</th><th></th></tr></thead><tbody>{run.lines.map(line=><tr key={line.key}><td><input value={line.collectionSite} onChange={e=>updateLine(run.key,line.key,{collectionSite:e.target.value})}/></td><td><input value={line.deliverySite} onChange={e=>updateLine(run.key,line.key,{deliverySite:e.target.value})}/></td><td><input type="number" min="1" value={line.pallets} onChange={e=>updateLine(run.key,line.key,{pallets:e.target.value})}/></td><td><button onClick={()=>updateRun(run.key,r=>({...r,lines:r.lines.length===1?[blankLine()]:r.lines.filter(x=>x.key!==line.key)}))}>Clear</button></td></tr>)}</tbody></table></div>
          <div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>updateRun(run.key,r=>({...r,lines:[...r.lines,blankLine()]}))}>+ Add line</button><button className="primary" disabled={busy} onClick={()=>void saveRun(run,index)}>Save Run {index+1}</button></div>
        </article>)}
      </div>
      <aside className="panel simple-orders"><div style={{display:"flex",justifyContent:"space-between",gap:8}}><div><p className="eyebrow">Orders to plan</p><h2>{visible.length} remaining</h2></div><strong>{control?.summary.outstanding ?? 0} pallets</strong></div><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search orders…"/>{visible.map(order=><button key={order.id} className="order-pick" onClick={()=>addOrder(order)}><strong>{order.collection} → {order.destination}</strong><span>{order.outstandingPallets} of {order.orderedPallets} remaining · {order.reference}</span></button>)}{!visible.length&&<p>All current orders are fully planned.</p>}</aside>
    </div>
  </section>;
}
