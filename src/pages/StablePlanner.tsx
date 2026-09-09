import { Navigate } from "react-router-dom";

/** Legacy planner route retained for bookmarks; the live planner is PlannerEnhanced. */
export function StablePlanner() {
  return <Navigate to="/" replace />;
}
