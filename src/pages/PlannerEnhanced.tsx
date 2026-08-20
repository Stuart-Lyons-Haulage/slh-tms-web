import { Link } from "react-router-dom";
import { RunPlannerLive } from "./RunPlannerLive";
import { SubcontractorQuickAdd } from "./SubcontractorQuickAdd";

export function PlannerEnhanced() {
  return <section className="planner-enhanced-page">
    <div className="panel planner-screen-switcher" style={{ marginBottom: 14, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 3 }}>Planning workspace</p>
        <strong>Run Planner</strong><br />
        <small>Orders stay on the right for click-to-add. Pallet balances update immediately and run quantities auto-save as they are amended.</small>
      </div>
      <Link className="button-like primary" to="/pallet-control" target="_blank" rel="noopener noreferrer">Open Pallet Control · Screen 2 ↗</Link>
    </div>
    <SubcontractorQuickAdd />
    <RunPlannerLive />
    <div className="mobile-planner-handoff">
      <strong>Allocation and dispatch are on Runs.</strong>
      <span>After the plan is built, assign the driver, vehicle and trailer from Runs. Subcontractor drivers and vehicles added above appear in the same master lists.</span>
      <Link to="/loads">Open Runs →</Link>
    </div>
  </section>;
}
