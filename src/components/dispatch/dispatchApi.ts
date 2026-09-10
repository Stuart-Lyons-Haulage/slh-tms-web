import { apiBaseUrl, request } from "../../lib/api";
import type {
  DispatchAllocationSelection,
  DispatchAvailableTimeDto,
  DispatchDriverDto,
  DispatchDriverStatusDto,
  DispatchEquipmentWorkbench,
  DispatchLockResponse,
  DispatchRunDto,
  DispatchVisibilitySnapshot
} from "./types";

export type DispatchReadiness = {
  canDispatch: boolean;
  explanation?: string;
  structuralReadiness?: {
    classification: "Recommended" | "Unverified" | "Blocked";
    requiresAcknowledgement: boolean;
    checks: Array<{ passed: boolean; message: string }>;
  };
};

export async function getDispatchVisibility(planningDate: string, token: string): Promise<DispatchVisibilitySnapshot> {
  return request<DispatchVisibilitySnapshot>(
    `/api/dispatch/driver-visibility?date=${encodeURIComponent(planningDate)}`,
    token
  );
}

export async function getSmartDispatch(
  planningDate: string,
  token: string
): Promise<{
  drivers: DispatchDriverDto[];
  runs: DispatchRunDto[];
  equipment: DispatchEquipmentWorkbench;
  statuses: Record<string, DispatchDriverStatusDto>;
  visibility: DispatchVisibilitySnapshot;
}> {
  const encoded = encodeURIComponent(planningDate);
  const [drivers, runs, equipment, statusResponse, visibility] = await Promise.all([
    request<DispatchDriverDto[]>(`/api/dispatch/drivers?date=${encoded}`, token),
    request<DispatchRunDto[]>(`/api/dispatch/runs?date=${encoded}`, token),
    request<DispatchEquipmentWorkbench>(`/api/v1/driver-dispatch?date=${encoded}`, token),
    request<{ drivers: DispatchDriverStatusDto[] }>(`/api/v1/driver-dispatch-status?date=${encoded}`, token),
    getDispatchVisibility(planningDate, token)
  ]);
  const visibilityByDriver = new Map(visibility.drivers.map(item => [item.driverId, item]));
  const enrichedDrivers = drivers
    .map(driver => ({
      ...driver,
      employmentType: visibilityByDriver.get(driver.driverId)?.employmentType ?? driver.employmentType,
      skills: visibilityByDriver.get(driver.driverId)?.skills ?? driver.skills,
      driverCode: visibilityByDriver.get(driver.driverId)?.coding?.trim() || driver.driverCode
    }));
  return {
    drivers: enrichedDrivers,
    runs,
    equipment,
    statuses: Object.fromEntries(statusResponse.drivers.map(status => [status.driverId, status])),
    visibility
  };
}

export async function syncDispatchDrivers(token: string): Promise<void> {
  await request("/api/v1/driver-master/tachomaster/sync", token, { method: "POST" }, 180000);
}

export async function getAvailableTimes(
  planningDate: string,
  driverIds: string[],
  token: string,
  reducedRestDriverIds: string[] = []
): Promise<DispatchAvailableTimeDto[]> {
  return request<DispatchAvailableTimeDto[]>("/api/dispatch/available-times", token, {
    method: "POST",
    body: JSON.stringify({ planningDate, driverIds, reducedRestDriverIds })
  });
}

export async function checkDispatchReadiness(
  runId: string,
  routeDrivingMinutes: number,
  acknowledgeUnverified: boolean,
  token: string
): Promise<DispatchReadiness> {
  return request<DispatchReadiness>(`/api/v1/loads/${encodeURIComponent(runId)}/dispatch-readiness`, token, {
    method: "POST",
    body: JSON.stringify({ routeDrivingMinutes, acknowledgeUnverified })
  }, 90000);
}

export async function sendDriverMessage(
  runId: string,
  message: string,
  dispatch: boolean,
  routeDrivingMinutes: number | null,
  acknowledgeUnverified: boolean,
  token: string
): Promise<void> {
  await request(`/api/v1/loads/${encodeURIComponent(runId)}/driver-message/sms`, token, {
    method: "POST",
    body: JSON.stringify({ message, dispatch, routeDrivingMinutes, acknowledgeUnverified })
  }, 90000);
}

export async function unassignDispatchRun(runId: string, token: string): Promise<void> {
  await request(`/api/v1/runs/${encodeURIComponent(runId)}/allocation`, token, {
    method: "PUT",
    body: JSON.stringify({ driverId: null, vehicleId: null, trailerId: null })
  }, 90000);
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
        plannedStartTime: selection.plannedStartTime,
        useReducedDailyRest: selection.useReducedDailyRest === true
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
