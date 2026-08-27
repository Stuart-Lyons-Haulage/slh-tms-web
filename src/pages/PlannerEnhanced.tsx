import { Link } from "react-router-dom";
import { useState } from "react";
import { OptimiserProposalReview } from "../components/OptimiserProposalReview";
import { RunGeofenceWarningPanel } from "../components/GeofenceCoverageWarnings";
import { signalPlanningChange } from "../lib/planningEvents";
import { RunPlannerLive } from "./RunPlannerLive";
import { PalletPlanningControl } from "./PalletPlanningControl";

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function PlannerEnhanced() {
  const [date, setDate] = useState(localDate());
  const [loadControlOpen, setLoadControlOpen] = useState(false);

  return <section className="planner-enhanced-page">
    <div className="panel planner-screen-switcher" style={{ marginBottom: 14, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 3 }}>Planning workspace</p>
        <strong>Run Planner</strong><br />
        <small>Build and amend runs here. Use Load Control alongside the plan for pallets, trays, trolleys, crates and mixed loads.</small>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className={loadControlOpen ? "primary" : ""} type="button" onClick={() => setLoadControlOpen(value => !value)}>{loadControlOpen ? "Close Load Control" : "Open Load Control"}</button>
        <Link className="button-like" to="/driver-dispatch">Driver Dispatch →</Link>
      </div>
    </div>

    <div className="planner-toolbar" style={{ marginTop: 0 }}>
      <label>
        Plan date{" "}
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <span>Approved loads for this date appear automatically in the planning pool.</span>
    </div>

    {loadControlOpen && <div className="panel" style={{ marginBottom: 16, padding: 12 }}>
      <div className="title-row" style={{ marginBottom: 8 }}><div><p className="eyebrow">Planner companion</p><h2>Load Control</h2><p className="hint">Keep quantity/capacity control open while the run plan is being built.</p></div></div>
      <PalletPlanningControl />
    </div>}

    <RunGeofenceWarningPanel planningDate={date} />
    <OptimiserProposalReview planningDate={date} onApplied={() => signalPlanningChange()} />
    <RunPlannerLive planningDate={date} />

    <div className="mobile-planner-handoff">
      <strong>When the work is built, move to Driver Dispatch.</strong>
      <span>Driver Dispatch allocates the driver, regular vehicle and trailer, records the start time, routes the run, checks compliance and sends the driver text.</span>
      <Link to="/driver-dispatch">Open Driver Dispatch →</Link>
    </div>
  </section>;
}
