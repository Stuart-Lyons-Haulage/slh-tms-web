import { z } from 'zod';
import { apiRequest, unknownObjectSchema } from './apiClient';

export const runStopSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().optional().nullable().transform(value => value ?? undefined),
  sequence: z.number().int(),
  name: z.string().min(1),
  address: z.string().optional().nullable().transform(value => value ?? undefined),
  latitude: z.number().optional().nullable().transform(value => value ?? undefined),
  longitude: z.number().optional().nullable().transform(value => value ?? undefined),
  plannedArrivalUtc: z.string().optional().nullable().transform(value => value ?? undefined),
}).passthrough();

export const runSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  planningDate: z.string().min(1),
  status: z.string().min(1),
  vehicleId: z.string().optional().nullable().transform(value => value ?? undefined),
  driverId: z.string().optional().nullable().transform(value => value ?? undefined),
  trailerId: z.string().optional().nullable().transform(value => value ?? undefined),
  stops: z.array(runStopSchema),
}).passthrough();

const dispatchSchema = z.object({
  reference: z.string().min(1),
  planningDate: z.string().min(1),
  status: z.string().min(1),
  driver: z.object({
    displayName: z.string(),
    employeeNumber: z.string(),
    mobileNumber: z.string().optional().nullable().transform(value => value ?? undefined),
  }).optional().nullable().transform(value => value ?? undefined),
  vehicle: z.object({
    registration: z.string(),
    fleetNumber: z.string().optional().nullable().transform(value => value ?? undefined),
  }).optional().nullable().transform(value => value ?? undefined),
  trailer: z.object({
    trailerNumber: z.string(),
    type: z.string().optional().nullable().transform(value => value ?? undefined),
  }).optional().nullable().transform(value => value ?? undefined),
  stops: z.array(z.object({
    sequence: z.number().int(),
    name: z.string().min(1),
    address: z.string().optional().nullable().transform(value => value ?? undefined),
    order: z.object({
      reference: z.string(),
      customerCode: z.string(),
      sellerName: z.string().optional().nullable().transform(value => value ?? undefined),
      marketName: z.string().optional().nullable().transform(value => value ?? undefined),
      stallNumber: z.string().optional().nullable().transform(value => value ?? undefined),
      driverInstructions: z.string().optional().nullable().transform(value => value ?? undefined),
      mapLink: z.string().optional().nullable().transform(value => value ?? undefined),
    }).optional().nullable().transform(value => value ?? undefined),
  }).passthrough()),
}).passthrough();

const allocationCheckSchema = z.object({
  warning: z.boolean(),
  protectedVehicle: z.boolean(),
  driverName: z.string().optional().nullable().transform(value => value ?? undefined),
  vehicleRegistration: z.string().optional().nullable().transform(value => value ?? undefined),
  confidencePercent: z.number().optional().nullable().transform(value => value ?? undefined),
  observedDays: z.number().optional().nullable().transform(value => value ?? undefined),
  nextPlannedDate: z.string().optional().nullable().transform(value => value ?? undefined),
  prompt: z.string().optional().nullable().transform(value => value ?? undefined),
}).passthrough();

export type Run = z.output<typeof runSchema>;
export type RunStop = z.output<typeof runStopSchema>;
export type RunDispatch = z.output<typeof dispatchSchema>;
export type CreateRun = {
  reference: string;
  planningDate: string;
  vehicleId?: string;
  driverId?: string;
  trailerId?: string;
  stops: Array<{
    orderId?: string;
    name: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    plannedArrivalUtc?: string;
  }>;
};
export type RunAllocation = { vehicleId?: string; driverId?: string; trailerId?: string };

function naturalRunNumber(reference: string) {
  const patterns = [
    /^PLAN-\d{8}-(\d+)$/i,
    /^RUN-\d{8}-(\d+)$/i,
    /^L0*(\d+)$/i,
    /(?:^|[-_\s])RUN[-_\s]*0*(\d+)(?:$|[-_\s])/i,
    /(?:^|[-_\s])0*(\d+)$/,
  ];
  for (const pattern of patterns) {
    const match = reference.trim().match(pattern);
    if (match) return Number(match[1]);
  }
  return Number.MAX_SAFE_INTEGER;
}

export function compareRuns(left: Pick<Run, 'planningDate' | 'reference'>, right: Pick<Run, 'planningDate' | 'reference'>) {
  const date = left.planningDate.localeCompare(right.planningDate);
  if (date) return date;
  const number = naturalRunNumber(left.reference) - naturalRunNumber(right.reference);
  if (number) return number;
  return left.reference.localeCompare(right.reference, undefined, { numeric: true, sensitivity: 'base' });
}

export async function listRuns(date?: string, token?: string) {
  const path = `/api/v1/runs${date ? `?date=${encodeURIComponent(date)}` : ''}`;
  const runs = await apiRequest(path, z.array(runSchema), token);
  return [...runs].sort(compareRuns);
}

export function createRun(payload: CreateRun, token?: string) {
  return apiRequest('/api/v1/runs', runSchema, token, { method: 'POST', body: JSON.stringify(payload) });
}

async function confirmPreferredVehicle(runId: string, payload: RunAllocation, token?: string) {
  if (!payload.vehicleId || !payload.driverId) return;
  try {
    const run = (await listRuns(undefined, token)).find(item => item.id === runId);
    if (!run?.planningDate) return;
    const query = new URLSearchParams({ vehicleId: payload.vehicleId, driverId: payload.driverId, date: run.planningDate });
    const check = await apiRequest(`/api/v1/driver-vehicle-preferences/allocation-check?${query}`, allocationCheckSchema, token);
    if (!check.warning || !check.prompt) return;
    const heading = check.protectedVehicle ? 'Protected regular vehicle' : 'Regular vehicle warning';
    if (!window.confirm(`${heading}\n\n${check.prompt}\n\nContinue with this allocation anyway?`)) {
      throw new Error('Allocation cancelled. Choose another vehicle or keep the regular vehicle with its usual driver.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Allocation cancelled')) throw error;
    console.warn('Preferred vehicle allocation check was unavailable; allocation will continue.', error);
  }
}

export async function allocateRun(id: string, payload: RunAllocation, token?: string) {
  await confirmPreferredVehicle(id, payload, token);
  return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/allocation`, runSchema, token, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateRunOperational(id: string, payload: Record<string, unknown>, token?: string) {
  return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/operational`, runSchema, token, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateRunStops(id: string, stops: CreateRun['stops'], token?: string) {
  const path = stops.length === 0
    ? `/api/v1/planning-control/runs/${encodeURIComponent(id)}/stops`
    : `/api/v1/runs/${encodeURIComponent(id)}/stops`;
  return apiRequest(path, runSchema, token, { method: 'PUT', body: JSON.stringify(stops) });
}

export function getRunRoute(id: string, token?: string) {
  return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/route`, unknownObjectSchema, token);
}

export function getRunDispatch(id: string, token?: string) {
  return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/dispatch`, dispatchSchema, token);
}

export function updateRunStatus(id: string, status: string, token?: string) {
  return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/status`, runSchema, token, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export const runsApi = {
  list: listRuns,
  create: createRun,
  allocate: allocateRun,
  updateOperational: updateRunOperational,
  updateStops: updateRunStops,
  route: getRunRoute,
  dispatch: getRunDispatch,
  updateStatus: updateRunStatus,
};
