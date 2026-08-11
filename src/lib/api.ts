export type Customer = { id: string; code: string; name: string; active: boolean };
export type CustomerContact = { id: string; customerCode: string; name: string; email?: string; mobileNumber?: string; receivesEtaUpdates: boolean; active: boolean };
export type Vehicle = { id: string; registration: string; fleetNumber?: string; abbreviation?: string; active: boolean };
export type Driver = { id: string; employeeNumber: string; displayName: string; mobileNumber?: string; driverType?: string; active: boolean };
export type Trailer = { id: string; trailerNumber: string; type?: string; standardCapacity?: number; active: boolean };
export type Site = { id: string; externalCode: string; name: string; driverTextName?: string; collectionAddress?: string; mapLink?: string; active: boolean };
export type MarketContact = { id: string; market: string; name: string; standOrLocation?: string; active: boolean };
export type StagedImport = { id: string; entityType: string; idempotencyKey: string; payloadJson: string; status: string; source?: string; receivedAtUtc: string; reviewedAtUtc?: string; reviewedBy?: string; reviewNote?: string };
export type TransportOrder = { id: string; reference: string; customerCode: string; collectionDate: string; deliveryDate?: string; deliveryWindowStartUtc?: string; deliveryWindowEndUtc?: string; pallets?: number; status: string; sellerName?: string; marketName?: string; stallNumber?: string; driverInstructions?: string; mapLink?: string };
export type Telemetry = { provider: string; retrievedAtUtc: string; recordCount: number; records: Array<{ vehicleIdentifier: string; eventTimeUtc: string; latitude?: number; longitude?: number; speedKph?: number; isMoving?: boolean; status?: string }> };
export type StageImportResponse = { stagingId: string; status: string; receivedAtUtc: string; reviewUrl: string };
export type LoadStop = { id: string; orderId?: string; sequence: number; name: string; address?: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string };
export type Load = { id: string; reference: string; planningDate: string; status: string; vehicleId?: string; driverId?: string; trailerId?: string; stops: LoadStop[] };
export type LoadDispatch = { reference: string; planningDate: string; status: string; driver?: { displayName: string; employeeNumber: string; mobileNumber?: string }; vehicle?: { registration: string; fleetNumber?: string }; trailer?: { trailerNumber: string; type?: string }; stops: Array<{ sequence: number; name: string; address?: string; order?: { reference: string; customerCode: string; sellerName?: string; marketName?: string; stallNumber?: string; driverInstructions?: string; mapLink?: string } }> };
export type CreateLoad = { reference: string; planningDate: string; vehicleId?: string; driverId?: string; trailerId?: string; stops: Array<{ orderId?: string; name: string; address?: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string }> };

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
  customerContacts: (token?: string) => request<CustomerContact[]>('/api/v1/customer-contacts', token),
  vehicles: (token?: string) => request<Vehicle[]>('/api/v1/vehicles', token),
  drivers: (token?: string) => request<Driver[]>('/api/v1/drivers', token),
  trailers: (token?: string) => request<Trailer[]>('/api/v1/trailers', token),
  sites: (token?: string) => request<Site[]>('/api/v1/sites', token),
  marketContacts: (token?: string) => request<MarketContact[]>('/api/v1/market-contacts', token),
  staging: (token?: string) => request<StagedImport[]>('/api/v1/staging?take=100', token),
  orders: (from?: string, to?: string, token?: string) => request<TransportOrder[]>(`/api/v1/orders?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`, token),
  stageOrder: (payload: Record<string, string>, idempotencyKey: string, token?: string) => request<StageImportResponse>('/api/v1/staging', token, { method: 'POST', body: JSON.stringify({ entityType: 'order', idempotencyKey, source: 'SLH TMS Web/CSV', payload }) }),
  stageRecord: (entityType: string, payload: Record<string, string | boolean | number | undefined>, idempotencyKey: string, token?: string) => request<StageImportResponse>('/api/v1/staging', token, { method: 'POST', body: JSON.stringify({ entityType, idempotencyKey, source: 'SLH TMS Web', payload }) }),
  telemetry: (token?: string) => request<Telemetry>('/api/v1/tracking/dot/telemetry', token),
  trackingHistory: (date: string, token?: string) => request<Telemetry>(`/api/v1/tracking/dot/history?date=${encodeURIComponent(date)}`, token),
  loads: (date?: string, token?: string) => request<Load[]>(`/api/v1/loads${date ? `?date=${date}` : ''}`, token),
  createLoad: (payload: CreateLoad, token?: string) => request<Load>('/api/v1/loads', token, { method: 'POST', body: JSON.stringify(payload) }),
  allocateLoad: (id: string, payload: { vehicleId?: string; driverId?: string; trailerId?: string }, token?: string) => request<Load>(`/api/v1/loads/${id}/allocation`, token, { method: 'PUT', body: JSON.stringify(payload) }),
  updateLoadStatus: (id: string, status: string, token?: string) => request<Load>(`/api/v1/loads/${id}/status`, token, { method: 'PUT', body: JSON.stringify({ status }) }),
  updateLoadStops: (id: string, stops: Array<{ orderId?: string; name: string; address?: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string }>, token?: string) => request<Load>(`/api/v1/loads/${id}/stops`, token, { method: 'PUT', body: JSON.stringify(stops) }),
  route: (loadId: string, token?: string) => request<Record<string, unknown>>(`/api/v1/loads/${loadId}/route`, token),
  dispatch: (loadId: string, token?: string) => request<LoadDispatch>(`/api/v1/loads/${loadId}/dispatch`, token),
  sendDispatchSms: (loadId: string, token?: string) => request<{ messageId: string; mobileSuffix: string; status: string }>(`/api/v1/loads/${loadId}/dispatch/sms`, token, { method: 'POST' }),
  geocode: (address: string, token?: string) => request<Record<string, unknown>>(`/api/v1/maps/geocode?address=${encodeURIComponent(address)}`, token),
  review: (id: string, approved: boolean, note: string, token?: string) => request(`/api/v1/staging/${id}/${approved ? 'approve' : 'reject'}`, token, { method: 'POST', body: JSON.stringify({ note }) })
};
