export type Customer = { id: string; code: string; name: string; active: boolean };
export type CustomerContact = { id: string; customerCode: string; name: string; email?: string; mobileNumber?: string; receivesEtaUpdates: boolean; active: boolean };
export type Vehicle = { id: string; registration: string; fleetNumber?: string; abbreviation?: string; active: boolean };
export type Driver = { id: string; employeeNumber: string; displayName: string; mobileNumber?: string; driverType?: string; active: boolean };
export type Trailer = { id: string; trailerNumber: string; type?: string; standardCapacity?: number; active: boolean };
export type Site = { id: string; externalCode: string; name: string; driverTextName?: string; collectionAddress?: string; collectionInstructions?: string; mapLink?: string; active: boolean };
export type MarketContact = { id: string; market: string; name: string; standOrLocation?: string; active: boolean };
export type StagedImport = { id: string; entityType: string; idempotencyKey: string; payloadJson: string; status: string | number; source?: string; receivedAtUtc: string; reviewedAtUtc?: string; reviewedBy?: string; reviewNote?: string };
export type TransportOrder = { id: string; reference: string; customerCode: string; collectionDate: string; deliveryDate?: string; deliveryWindowStartUtc?: string; deliveryWindowEndUtc?: string; pallets?: number; status: string; sellerName?: string; marketName?: string; stallNumber?: string; driverInstructions?: string; mapLink?: string };
export type Telemetry = { provider: string; retrievedAtUtc: string; recordCount: number; records: Array<{ vehicleIdentifier: string; eventTimeUtc: string; latitude?: number; longitude?: number; speedKph?: number; isMoving?: boolean; status?: string }> };
export type FleetStatus = { provider: string; retrievedAtUtc: string; vehicleCount: number; readyCount: number; attentionCount: number; vehicles: Array<{ vehicleId: string; registration: string; fleetNumber?: string; trackingIdentifier?: string; condition: 'Moving' | 'Started' | 'Stationary' | 'SignedOn' | 'Stale' | 'NotSignedOn'; lastEventTimeUtc?: string; ignitionOn?: boolean; isMoving?: boolean; speedKph?: number; latitude?: number; longitude?: number; ageMinutes?: number; loadReference?: string; loadStatus?: string; driverName?: string }> };
export type StageImportResponse = { stagingId: string; status: string; receivedAtUtc: string; reviewUrl: string };
export type StageBatchRequest = { entityType: string; idempotencyKey: string; source?: string; payload: Record<string, string | boolean | number | undefined> };
export type StageBatchResponse = { received: number; existing: number; created: number; records: StageImportResponse[] };
export type LoadStop = { id: string; orderId?: string; sequence: number; name: string; address?: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string };
export type Load = { id: string; reference: string; planningDate: string; status: string; vehicleId?: string; driverId?: string; trailerId?: string; stops: LoadStop[] };
export type LoadDispatch = { reference: string; planningDate: string; status: string; driver?: { displayName: string; employeeNumber: string; mobileNumber?: string }; vehicle?: { registration: string; fleetNumber?: string }; trailer?: { trailerNumber: string; type?: string }; stops: Array<{ sequence: number; name: string; address?: string; order?: { reference: string; customerCode: string; sellerName?: string; marketName?: string; stallNumber?: string; driverInstructions?: string; mapLink?: string } }> };
export type CreateLoad = { reference: string; planningDate: string; vehicleId?: string; driverId?: string; trailerId?: string; stops: Array<{ orderId?: string; name: string; address?: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string }> };
export type DriverAssignment = { loadId: string; planningDate: string; loadReference: string; status: string; driver?: { id: string; displayName: string; employeeNumber: string }; vehicle?: { id: string; registration: string; fleetNumber?: string }; trailerNumber?: string; stopCount: number; finalStop?: string; finalLatitude?: number; finalLongitude?: number };
export type ReturnLoadSuggestion = { driverId: string; driverName: string; employeeNumber: string; consecutiveDays: number; previousLoadReference: string; previousPlanningDate: string; lastLocation?: string; latitude?: number; longitude?: number; suggestedLoadId?: string; suggestedLoadReference?: string; priority: number; reason: string };
export type ReturnLoadSuggestions = { planningDate: string; generatedAtUtc: string; suggestions: ReturnLoadSuggestion[] };
export type SageHrStatus = { configured: boolean; connected: boolean; employeeCount: number; driverCandidateCount: number; missingSettings?: string[]; message: string };
export type RoadTechStatus = { configured: boolean; connected: boolean; recordCount: number; latestEventUtc?: string; missingSettings?: string[]; message: string };
export type SageHrSync = { sourceEmployeeCount: number; driverCandidateCount: number; created: number; updated: number; skipped: number; syncedAtUtc: string };
export type DeliveryEta = { loadId: string; loadReference: string; loadStatus: string; stopId: string; sequence: number; stopName: string; orderReference?: string; customerCode?: string; vehicleRegistration?: string; etaUtc?: string; source: 'Live' | 'Planned' | 'Unavailable'; deliveryWindowStartUtc?: string; deliveryWindowEndUtc?: string; risk: 'Pending' | 'Late' | 'AtRisk' | 'OnTrack'; trackingUpdatedAtUtc?: string };
export type DeliveryEtas = { planningDate: string; calculatedAtUtc: string; records: DeliveryEta[] };
export type IntegrationStatus = { roadTech: { configured: boolean; connected: boolean; latestEventUtc?: string }; azureMaps: { configured: boolean }; azureSms: { configured: boolean }; sageHr: { configured: boolean }; emailIntake: { configured: boolean; lastReceivedUtc?: string }; batchIntake: { configured: boolean; endpoint: string } };

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/tms-api').replace(/\/$/, '');
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  if (!baseUrl) throw new ApiError(0, 'Set VITE_API_BASE_URL to connect the TMS API.');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const message = response.status === 403
      ? 'Microsoft sign-in worked, but your account has not been granted TMS API access yet.'
      : error?.detail || error?.message || `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }
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
  staging: (token?: string, status = 'PendingReview') => request<StagedImport[]>(`/api/v1/staging?take=500${status ? `&status=${encodeURIComponent(status)}` : ''}`, token),
  orders: (from?: string, to?: string, token?: string) => request<TransportOrder[]>(`/api/v1/orders?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`, token),
  stageOrder: (payload: Record<string, string>, idempotencyKey: string, token?: string) => request<StageImportResponse>('/api/v1/staging', token, { method: 'POST', body: JSON.stringify({ entityType: 'order', idempotencyKey, source: 'SLH TMS Web/CSV', payload }) }),
  stageRecord: (entityType: string, payload: Record<string, string | boolean | number | undefined>, idempotencyKey: string, token?: string) => request<StageImportResponse>('/api/v1/staging', token, { method: 'POST', body: JSON.stringify({ entityType, idempotencyKey, source: 'SLH TMS Web', payload }) }),
  stageBatch: (records: StageBatchRequest[], token?: string) => request<StageBatchResponse>('/api/v1/staging/batch', token, { method: 'POST', body: JSON.stringify(records) }),
  telemetry: (token?: string) => request<Telemetry>('/api/v1/tracking/dot/telemetry', token),
  fleetStatus: (token?: string) => request<FleetStatus>('/api/v1/tracking/dot/fleet-status', token),
  trackingHistory: (date: string, token?: string) => request<Telemetry>(`/api/v1/tracking/dot/history?date=${encodeURIComponent(date)}`, token),
  loads: (date?: string, token?: string) => request<Load[]>(`/api/v1/loads${date ? `?date=${date}` : ''}`, token),
  driverAssignments: (from: string, to: string, token?: string) => request<DriverAssignment[]>(`/api/v1/driver-assignments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token),
  returnLoadSuggestions: (date: string, token?: string) => request<ReturnLoadSuggestions>(`/api/v1/planning/return-load-suggestions?date=${encodeURIComponent(date)}`, token),
  deliveryEtas: (date: string, token?: string) => request<DeliveryEtas>(`/api/v1/operations/delivery-etas?date=${encodeURIComponent(date)}`, token),
  createLoad: (payload: CreateLoad, token?: string) => request<Load>('/api/v1/loads', token, { method: 'POST', body: JSON.stringify(payload) }),
  allocateLoad: (id: string, payload: { vehicleId?: string; driverId?: string; trailerId?: string }, token?: string) => request<Load>(`/api/v1/loads/${id}/allocation`, token, { method: 'PUT', body: JSON.stringify(payload) }),
  updateLoadStatus: (id: string, status: string, token?: string) => request<Load>(`/api/v1/loads/${id}/status`, token, { method: 'PUT', body: JSON.stringify({ status }) }),
  updateLoadStops: (id: string, stops: Array<{ orderId?: string; name: string; address?: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string }>, token?: string) => request<Load>(`/api/v1/loads/${id}/stops`, token, { method: 'PUT', body: JSON.stringify(stops) }),
  route: (loadId: string, token?: string) => request<Record<string, unknown>>(`/api/v1/loads/${loadId}/route`, token),
  dispatch: (loadId: string, token?: string) => request<LoadDispatch>(`/api/v1/loads/${loadId}/dispatch`, token),
  sendDispatchSms: (loadId: string, token?: string) => request<{ messageId: string; mobileSuffix: string; status: string }>(`/api/v1/loads/${loadId}/dispatch/sms`, token, { method: 'POST' }),
  geocode: (address: string, token?: string) => request<Record<string, unknown>>(`/api/v1/maps/geocode?address=${encodeURIComponent(address)}`, token),
  sageHrStatus: (token?: string) => request<SageHrStatus>('/api/v1/integrations/sage-hr/status', token),
  roadTechStatus: (token?: string) => request<RoadTechStatus>('/api/v1/integrations/roadtech/status', token),
  integrationStatus: (token?: string) => request<IntegrationStatus>('/api/v1/integrations/status', token),
  syncSageHrDrivers: (token?: string) => request<SageHrSync>('/api/v1/integrations/sage-hr/sync-drivers', token, { method: 'POST' }),
  review: (id: string, approved: boolean, note: string, token?: string) => request(`/api/v1/staging/${id}/${approved ? 'approve' : 'reject'}`, token, { method: 'POST', body: JSON.stringify({ note }) })
};
