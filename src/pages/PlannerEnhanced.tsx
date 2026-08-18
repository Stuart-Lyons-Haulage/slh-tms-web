import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Load } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { RunPlanningIntelligence } from "../components/RunPlanningIntelligence";
import { StablePlanner } from "./StablePlanner";

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const ukDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`));

export function PlannerEnhanced() {
  const token = useAccessToken();
  const [date, setDate] = useState(today());
  const [selectedId, setSelectedId] = useState<string>();
  const loadsApi = useApi(useCallback(async () => api.loads(date, await token()), [date, token]));
  const loads = useMemo(() => (loadsApi.data || []).filter(Boolean), [loadsApi.data]);
  const selected = loads.find(x => x.id === selectedId) || loads[0];

  return <section className="planner-enhanced-page">
    <div className="panel planner-screen-switcher" style={{ marginBottom: 14, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
      <div><p className="eyebrow" style={{ marginBottom: 3 }}>Planning workspace</p><strong>Run Planner</strong><br/><small>Build runs here. Pallet Control remains available for the live order/outstanding matrix.</small></div>
      <Link className="button-like primary" to="/pallet-control">Open Pallet Control</Link>
    </div>
    <StablePlanner />
    <section className="planner-desktop-secondary" style={{ marginTop: 18, paddingTop: 18, borderTop: "3px solid #d8e5e9" }}>
      <div className="title-row">
        <div><p className="eyebrow">Allocation & compliance</p><h2>Driver, vehicle and night-out control</h2><p>Search drivers by name and vehicles by registration or last three. Suggestions use previous-run position, DOT live position and Tachomaster availability.</p></div>
        <label>Planning date <input type="date" value={date} onChange={e => { setDate(e.target.value); setSelectedId(undefined); }} /></label>
      </div>
      <div className="planner-intelligence-layout" style={{ display: "grid", gridTemplateColumns: "minmax(220px,0.35fr) minmax(0,1fr)", gap: 14 }}>
        <div className="panel" style={{ maxHeight: 600, overflow: "auto" }}>
          <strong>Runs · {ukDate(date)}</strong>
          {!loads.length && <p>No runs are saved for this date.</p>}
          {loads.map((load: Load) => <button key={load.id} type="button" onClick={() => setSelectedId(load.id)} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 7, border: selected?.id === load.id ? "2px solid #0b5f78" : undefined }}>
            <strong>{load.reference}</strong><br/><small>{load.status} · {load.stops?.length || 0} stops</small>
          </button>)}
        </div>
        <div>{selected ? <RunPlanningIntelligence load={selected} onChanged={loadsApi.refresh} /> : <div className="panel">Select or create a run to see planning intelligence.</div>}</div>
      </div>
    </section>
    <div className="mobile-planner-handoff"><strong>Allocation and dispatch are on Runs.</strong><span>Use the Runs button below after building the plan to assign the driver, vehicle and trailer.</span><Link to="/loads">Open Runs →</Link></div>
  </section>;
}
