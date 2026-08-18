import { useCallback, useMemo, useState } from "react";
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

  return <>
    <StablePlanner />
    <section style={{ marginTop: 18, paddingTop: 18, borderTop: "3px solid #d8e5e9" }}>
      <div className="title-row">
        <div><p className="eyebrow">Allocation & compliance</p><h2>Driver, vehicle and night-out control</h2><p>Search drivers by name and vehicles by registration or last three. Suggestions use previous-run position, DOT live position and Tachomaster availability.</p></div>
        <label>Planning date <input type="date" value={date} onChange={e => { setDate(e.target.value); setSelectedId(undefined); }} /></label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,0.35fr) minmax(0,1fr)", gap: 14 }}>
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
  </>;
}