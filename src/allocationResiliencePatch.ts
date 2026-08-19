import { api, request, type Load, type LoadDispatch } from "./lib/api";

// Runs now use the operational API path throughout. This path deliberately
// avoids the legacy costing/commercial persistence layer.
api.loads = (date, token) =>
  request<Load[]>(`/api/v1/runs${date ? `?date=${encodeURIComponent(date)}` : ""}`, token);

api.allocateLoad = (id, payload, token) =>
  request<Load>(`/api/v1/runs/${id}/allocation`, token, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

api.updateLoadUtilisation = (id, payload, token) =>
  request<Load>(`/api/v1/runs/${id}/operational`, token, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

api.updateLoadStops = (id, stops, token) =>
  request<Load>(`/api/v1/runs/${id}/stops`, token, {
    method: "PUT",
    body: JSON.stringify(stops),
  });

api.route = (id, token) =>
  request<Record<string, unknown>>(`/api/v1/runs/${id}/route`, token);

api.dispatch = (id, token) =>
  request<LoadDispatch>(`/api/v1/runs/${id}/dispatch`, token);
