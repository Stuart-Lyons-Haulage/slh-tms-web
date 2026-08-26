import { Link } from "react-router-dom";
import { useState } from "react";
import { OptimiserProposalReview } from "../components/OptimiserProposalReview";
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
        <small>Build and amend runs here. Order approval stays in Review orders; live quantity control stays on the planner's second screen.</small>
      </div>
      <Link className="button-like primary" to="/pallet-control" target="_blank" rel="noopener noreferrer">Open Pallet Control · Screen 2 ↗</Link>
    </div>

    <div className="planner-toolbar" style={{ marginTop: 0 }}>
      <label>
        Plan date{" "}
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <span>Approved orders for this date appear automatically in the planning pool.</span>
    </div>

    <OptimiserProposalReview planningDate={date} onApplied={() => signalPlanningChange()} />
    <RunPlannerLive planningDate={date} />

    <div className="mobile-planner-handoff">
      <strong>Allocation and dispatch are on Runs.</strong>
      <span>After the plan is built, assign the driver, vehicle and trailer from Runs. Master records and subcontractor details are maintained outside this planning workspace.</span>
      <Link to="/loads">Open Runs →</Link>
    </div>
  </section>;
}
