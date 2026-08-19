import { api, request, type Load } from "./lib/api";

// The general operational stop editor intentionally rejects an empty stop list. The live
// planner needs one exception: when the last order is removed from a Draft run, its stops
// must be cleared at the same time as the pallet allocation. Route only that empty update
// through the planner-specific API; all normal stop updates keep their existing behaviour.
const originalUpdateLoadStops = api.updateLoadStops.bind(api);
type StopList = Parameters<typeof api.updateLoadStops>[1];

api.updateLoadStops = (async (id: string, stops: StopList, token?: string) => {
  if (stops.length > 0) return originalUpdateLoadStops(id, stops, token);
  return request<Load>(`/api/v1/planning-control/runs/${id}/stops`, token, {
    method: "PUT",
    body: JSON.stringify(stops),
  });
}) as typeof api.updateLoadStops;
