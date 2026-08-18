import { api, request } from "./lib/api";

type AllocationCheck = {
  warning: boolean;
  protectedVehicle: boolean;
  driverName?: string;
  vehicleRegistration?: string;
  confidencePercent?: number;
  observedDays?: number;
  nextPlannedDate?: string;
  prompt?: string;
};

const originalAllocateLoad = api.allocateLoad;

api.allocateLoad = async (id, payload, token) => {
  if (payload.vehicleId && payload.driverId) {
    try {
      const loads = await api.loads(undefined, token);
      const load = loads.find((item) => item.id === id);
      if (load?.planningDate) {
        const query = new URLSearchParams({
          vehicleId: payload.vehicleId,
          driverId: payload.driverId,
          date: load.planningDate,
        });
        const check = await request<AllocationCheck>(`/api/v1/driver-vehicle-preferences/allocation-check?${query}`, token);
        if (check.warning && check.prompt) {
          const heading = check.protectedVehicle ? "Protected regular vehicle" : "Regular vehicle warning";
          const confirmed = window.confirm(`${heading}\n\n${check.prompt}\n\nContinue with this allocation anyway?`);
          if (!confirmed) throw new Error("Allocation cancelled. Choose another vehicle or keep the regular vehicle with its usual driver.");
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Allocation cancelled")) throw error;
      console.warn("Preferred vehicle allocation check was unavailable; allocation will continue.", error);
    }
  }

  return originalAllocateLoad(id, payload, token);
};
