import { Navigate } from "react-router-dom";

/** Legacy planner lab route retained for bookmarks; the live planner is PlannerEnhanced. */
export function OperationalPlanner() {
  return <Navigate to="/" replace />;
}
