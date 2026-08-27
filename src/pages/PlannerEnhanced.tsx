import { Link } from "react-router-dom";
import { useState } from "react";
import { OptimiserProposalReview } from "../components/OptimiserProposalReview";
import { RunGeofenceWarningPanel } from "../components/GeofenceCoverageWarnings";
import { signalPlanningChange } from "../lib/planningEvents";
import { RunPlannerLive } from "./RunPlannerLive";

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function PlannerEnhanced() {
  const [date, setDate] = useState(localDate());

  return <section className="planner-enhanced-page">
    <div className="panel planner-screen-switcher" style={{ marginBottom: 14, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 3 }}>Planning workspace</p>
        <strong>Run Planner</strong><br />
        <small>Build and amend runs here. Pallet Control remains the live second-screen view for pallets, trays, trolleys, crates and split allocations.</small>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className="button-like primary" to="/pallet-control">Open Pallet Control →</Link>
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

    <RunGeofenceWarningPanel planningDate={date} />
    <OptimiserProposalReview planningDate={date} onApplied={() => signalPlanningChange()} />
    <RunPlannerLive planningDate={date} />

    <div className="mobile-planner-handoff">
      <strong>Keep Pallet Control alongside planning, then move to Driver Dispatch.</strong>
      <span>Pallet Control updates every 2 seconds as splits are made. Driver Dispatch then allocates the driver, regular vehicle and trailer, records the start time, routes the run, checks live compliance and sends the driver text.</span>
      <Link to="/pallet-control">Open Pallet Control →</Link>
      <Link to="/driver-dispatch">Open Driver Dispatch →</Link>
    </div>
  </section>;
}
