export type Customer = { id: string; code: string; name: string; active: boolean };
export type Vehicle = { id: string; registration: string; fleetNumber?: string; abbreviation?: string; active: boolean };
export type Driver = { id: string; employeeNumber: string; displayName: string; driverType?: string; active: boolean };
export type Trailer = { id: string; trailerNumber: string; type?: string; standardCapacity?: number; active: boolean };
export type StagedImport = { id: string; entityType: string; idempotencyKey: string; payloadJson: string; status: string; source?: string; receivedAtUtc: string; reviewedAtUtc?: string; reviewedBy?: string; reviewNote?: string };
export type Telemetry = { provider: string; retrievedAtUtc: string; recordCount: number; records: Array<{ vehicleIdentifier: string; eventTimeUtc: string; latitude?: number; longitude?: number; speedKph?: number; isMoving?: boolean; status?: string }> };
export type StageImportResponse = { stagingId: string; status: string; receivedAtUtc: string; reviewUrl: string };
export type LoadStop = { id: string; sequence: number; name: string; address?: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string };
export type Load = { id: string; reference: string; planningDate: string; status: string; vehicleId?: string; driverId?: string; trailerId?: string; stops: LoadStop[] };

const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  if (!baseUrl) throw new ApiError(0, 'Set VITE_API_BASE_URL to connect the TMS API.');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } });
  if (!response.ok) { const error = await response.json().catch(() => null); throw new ApiError(response.status, error?.detail || error?.message || `Request failed (${response.status}).`); }
  return response.json() as Promise<T>;
}

export const api = {
  customers: (token?: string) => request<Customer[]>('/api/v1/customers', token),
  vehicles: (token?: string) => request<Vehicle[]>('/api/v1/vehicles', token),
  drivers: (token?: string) => request<Driver[]>('/api/v1/drivers', token),
  trailers: (token?: string) => request<Trailer[]>('/api/v1/trailers', token),
  staging: (token?: string) => request<StagedImport[]>('/api/v1/staging?take=100', token),
  stageOrder: (payload: Record<string, string>, idempotencyKey: string, token?: string) => request<StageImportResponse>('/api/v1/staging', token, { method: 'POST', body: JSON.stringify({ entityType: 'order', idempotencyKey, source: 'SLH TMS Web/CSV', payload }) }),
  telemetry: (token?: string) => request<Telemetry>('/api/v1/tracking/dot/telemetry', token),
  loads: (date?: string, token?: string) => request<Load[]>(`/api/v1/loads${date ? `?date=${date}` : ''}`, token),
  review: (id: string, approved: boolean, note: string, token?: string) => request(`/api/v1/staging/${id}/${approved ? 'approve' : 'reject'}`, token, { method: 'POST', body: JSON.stringify({ note }) })
};
