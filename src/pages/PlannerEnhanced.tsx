import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { OptimiserProposalReview } from "../components/OptimiserProposalReview";
import { signalPlanningChange } from "../lib/planningEvents";
import { RunPlannerLive } from "./RunPlannerLive";
import { SubcontractorQuickAdd } from "./SubcontractorQuickAdd";
import { api } from "../lib/api";
import { useAccessToken } from "../lib/auth";

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function PlannerEnhanced() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const [reviewOrderCount, setReviewOrderCount] = useState<number>();
  const refreshReviewOrderCount = useCallback(async () => {
    try {
      const rows = await api.staging(await token(), "PendingReview", "order", 2000);
      setReviewOrderCount(rows.length);
    } catch {
      setReviewOrderCount(undefined);
    }
  }, [token]);
  useEffect(() => {
    void refreshReviewOrderCount();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshReviewOrderCount();
    }, 30000);
    return () => window.clearInterval(id);
  }, [refreshReviewOrderCount]);

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
    <div className="planner-toolbar" style={{ marginTop: 0 }}>
      <label>
        Plan date{" "}
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <span>Approved orders for this date appear automatically in the planning pool.</span>
    </div>
    <div className="panel" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 3 }}>Automatic order intake</p>
        <strong>Info mailbox orders are staged for review before planning.</strong><br />
        <small>Power Automate submits new mailbox orders to the TMS. Review, amend, approve or reject them in Order control; only approved orders enter live planning.</small>
      </div>
      <Link className="button-like primary review-orders-link" to="/staging">Review orders{reviewOrderCount !== undefined && reviewOrderCount > 0 && <b className="nav-count planner-review-count" aria-label={`${reviewOrderCount} orders awaiting review`}>{reviewOrderCount > 1999 ? "2000+" : reviewOrderCount}</b>} →</Link>
    </div>
    <OptimiserProposalReview planningDate={date} onApplied={() => signalPlanningChange()} />
    <RunPlannerLive planningDate={date} />
    <div className="mobile-planner-handoff">
      <strong>Allocation and dispatch are on Runs.</strong>
      <span>After the plan is built, assign the driver, vehicle and trailer from Runs. Subcontractor drivers and vehicles added above appear in the same master lists.</span>
      <Link to="/loads">Open Runs →</Link>
    </div>
  </section>;
}
