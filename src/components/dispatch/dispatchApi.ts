import { apiBaseUrl, request } from "../../lib/api";
import type {
  DispatchAllocationSelection,
  DispatchAvailableTimeDto,
  DispatchDriverDto,
  DispatchEquipmentWorkbench,
  DispatchLockResponse,
  DispatchRunDto
} from "./types";

export async function getSmartDispatch(
  planningDate: string,
  token: string
): Promise<{ drivers: DispatchDriverDto[]; runs: DispatchRunDto[]; equipment: DispatchEquipmentWorkbench }> {
  const encoded = encodeURIComponent(planningDate);
  const [drivers, runs, equipment] = await Promise.all([
    request<DispatchDriverDto[]>(`/api/dispatch/drivers?date=${encoded}`, token),
    request<DispatchRunDto[]>(`/api/dispatch/runs?date=${encoded}`, token),
    request<DispatchEquipmentWorkbench>(`/api/v1/driver-dispatch?date=${encoded}`, token)
  ]);
  return { drivers, runs, equipment };
}

export async function getAvailableTimes(
  planningDate: string,
  driverIds: string[],
  token: string
): Promise<DispatchAvailableTimeDto[]> {
  return request<DispatchAvailableTimeDto[]>("/api/dispatch/available-times", token, {
    method: "POST",
    body: JSON.stringify({ planningDate, driverIds })
  });
}

export async function lockDispatchPlan(
  planningDate: string,
  selections: Array<{ driverId: string; selection: DispatchAllocationSelection }>,
  token: string
): Promise<DispatchLockResponse> {
  const response = await fetch(`${apiBaseUrl}/api/dispatch/lock`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      planningDate,
      allocations: selections.map(({ driverId, selection }) => ({
        driverId,
        vehicleId: selection.vehicleId,
        trailerId: selection.trailerId || null,
        runId: selection.runId,
        plannedStartTime: selection.plannedStartTime
      }))
    })
  });

  const payload = (await response.json().catch(() => ({ success: false, failures: [] }))) as DispatchLockResponse;
  if (response.ok) return payload;
  if (payload.failures?.length) return payload;
  return {
    success: false,
    failures: [{ driverId: "", reason: `Plan lock failed (${response.status}). Refresh and try again.` }]
  };
}
