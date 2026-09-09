import { Navigate } from "react-router-dom";

/** Legacy planner v3 route retained for bookmarks; the live planner is PlannerEnhanced. */
export function PlannerV3() {
  return <Navigate to="/" replace />;
}
