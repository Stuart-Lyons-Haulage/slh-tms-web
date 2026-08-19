import { api, request, type Load } from "./lib/api";

// Use the dedicated operational allocation endpoint. It writes the core run
// assignment without touching costing/commercial persistence.
api.allocateLoad = (id, payload, token) =>
  request<Load>(`/api/v1/runs/${id}/allocation`, token, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

// Capacity is secondary to the driver/vehicle assignment. Legacy production
// databases can still lack optional operational metadata storage, so do not
// turn a successful allocation into a visible 500 because that follow-up save
// failed. Keep the current run visible and allow the allocation to proceed.
const originalUpdateLoadUtilisation = api.updateLoadUtilisation;
api.updateLoadUtilisation = async (...args: Parameters<typeof originalUpdateLoadUtilisation>): Promise<Load> => {
  try {
    return await originalUpdateLoadUtilisation(...args);
  } catch (error) {
    const [id, _payload, token] = args;
    const current = (await api.loads(undefined, token)).find(load => load.id === id);
    if (current) return current;
    throw error;
  }
};
