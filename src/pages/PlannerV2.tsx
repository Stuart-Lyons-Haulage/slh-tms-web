import { Navigate } from "react-router-dom";

/** Legacy planner v2 route retained for bookmarks; the live planner is PlannerEnhanced. */
export function PlannerV2() {
  return <Navigate to="/" replace />;
}
