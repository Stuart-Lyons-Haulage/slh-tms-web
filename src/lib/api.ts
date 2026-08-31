import { geocode as geocodeAddress } from '../api/maps';
import { normaliseMarketContacts, normaliseMarketMasterRecords } from '../api/market';
import type { DriverAssignmentDto, DriverDto, VehicleDto } from '../types/dto/allocation';
import type { DispatchSmsResponseDto, RunDispatchDto } from '../types/dto/dispatch';
import type { OrderDto } from '../types/dto/order';
import type { CreateRunDto, RunDto, RunStopDto } from '../types/dto/run';
import type { DeliveryEtaDto, DeliveryEtasDto, FleetStatusDto, TelemetryDto } from '../types/dto/tracking';

export type Customer = { id: string; code: string; name: string; active: boolean; address?: string; email?: string; phone?: string };
export type CustomerContact = { id: string; customerCode: string; name: string; email?: string; mobileNumber?: string; receivesEtaUpdates: boolean; active: boolean };
export type Vehicle = VehicleDto;
export type Driver = DriverDto;
export type Trailer = { id: string; trailerNumber: string; type?: string; standardCapacity?: number; euroCapacity?: number; active: boolean };
export type Site = { id: string; externalCode: string; name: string; driverTextName?: string; collectionAddress?: string; collectionInstructions?: string; mapLink?: string; latitude?: number; longitude?: number; aliases?: string; active: boolean };
export type MarketContact = { id: string; market: string; name: string; standOrLocation?: string; salesman?: string; sender?: string; active: boolean };
export type FuelPrice = { id: string; weekCommencing: string; provider: string; pricePencePerLitre: number; isPricingMaximum: boolean; source?: string; notes?: string; createdAtUtc: string };
export type StagedImport = { id: string; entityType: string; idempotencyKey: string; payloadJson: string; status: string | number; source?: string; receivedAtUtc: string; reviewedAtUtc?: string; reviewedBy?: string; reviewNote?: string };
export type TransportOrder = OrderDto;
export type Telemetry = TelemetryDto;
export type FleetStatus = FleetStatusDto;
export type StageImportResponse = { stagingId: string; status: string; receivedAtUtc: string; reviewUrl: string };
export type StageBatchRequest = { entityType: string; idempotencyKey: string; source?: string; payload: Record<string, string | boolean | number | undefined> };
export type StageBatchResponse = { received: number; existing: number; created: number; records: StageImportResponse[] };
export type MasterApplyResponse = { received: number; applied: number; failed: number; linked?: number; registered?: number; results: Array<{ entityType: string; idempotencyKey?: string; applied: boolean; registered?: boolean; error?: string }> };
export type LoadStop = RunStopDto;
export type Load = RunDto;
export type LoadDispatch = RunDispatchDto;
export type CreateLoad = CreateRunDto;
export type DriverAssignment = DriverAssignmentDto;
export type ReturnLoadSuggestion = { driverId: string; driverName: string; employeeNumber: string; consecutiveDays: number; previousLoadReference: string; previousPlanningDate: string; lastLocation?: string; latitude?: number; longitude?: number; suggestedLoadId?: string; suggestedLoadReference?: string; priority: number; reason: string };
export type ReturnLoadSuggestions = { planningDate: string; generatedAtUtc: string; suggestions: ReturnLoadSuggestion[] };
export type SageHrStatus = { configured: boolean; connected: boolean; employeeCount: number; driverCandidateCount: number; missingSettings?: string[]; message: string };
export type RoadTechStatus = { configured: boolean; connected: boolean; recordCount: number; latestEventUtc?: string; missingSettings?: string[]; message: string };
export type SageHrSync = { sourceEmployeeCount: number; driverCandidateCount: number; created: number; updated: number; skipped: number; syncedAtUtc: string; connected?: boolean; message?: string };
export type DeliveryEta = DeliveryEtaDto;
export type DeliveryEtas = DeliveryEtasDto;
export type IntegrationStatus = { roadTech: { configured: boolean; connected: boolean; latestEventUtc?: string }; azureMaps: { configured: boolean }; azureSms: { configured: boolean }; textBee?: { configured: boolean; dutyPhoneLabel?: string; missingSettings?: string[] }; fleetio?: { configured: boolean; missingSettings?: string[] }; sageHr: { configured: boolean }; emailIntake: { configured: boolean; lastReceivedUtc?: string }; batchIntake: { configured: boolean; endpoint: string } };
export type FleetioStatus = { configured: boolean; connected: boolean; sampleVehicleCount: number; missingSettings?: string[]; message: string };
export type FleetioSync = { sourceVehicleCount: number; tmsVehicleCount: number; updated: number; created?: number; missingInFleetio: number; syncedAtUtc: string; connected?: boolean; message?: string };
export type FleetioVehicleAlignment = { configured: boolean; connected: boolean; matched: number; unmatchedFleetio: number; missingInFleetio: number; missingSettings?: string[]; message: string; records: Array<{ tmsVehicleId?: string; tmsRegistration?: string; tmsFleetNumber?: string; tmsAbbreviation?: string; fleetioId?: string; fleetioRegistration?: string; fleetioName?: string; fleetioFleetNumber?: string; fleetioStatus?: string; status: 'Matched' | 'MissingInFleetio' | 'UnmatchedFleetio' }> };
export type DiagnosticsTables = Record<string, { ok: boolean; count?: number; error?: string }>;
export type AssistantSuggestion = { id: string; severity: string; title: string; detail: string; area: string; autoFixAvailable: boolean };
export type AssistantSnapshot = { source: string; aiConfigured: boolean; metrics: { unplannedOrders: number; unallocatedLoads: number; vehicleComplianceRisks: number; missingSiteMapPoints: number; duplicateSiteGroups: number }; suggestions: AssistantSuggestion[] };
export type AssistantAdvice = { answer: string; source: string; suggestions: AssistantSuggestion[] };
export type SafeFixResult = { applied: number; skipped: number; changes?: string[]; skippedReasons?: string[] };
export type CustomerCommunication = { id?: string; loadId?: string; loadReference?: string; orderReference?: string; customerCode?: string; customerName?: string; recipient?: string; subject?: string; status?: string; sentAtUtc?: string; claims?: Array<{ label?: string; value?: string; status?: string }>; [key: string]: unknown };

type UnknownRecord = Record<string, unknown>;

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/tms-api').replace(/\/$/, '');
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

function errorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  return typeof record.detail === 'string' ? record.detail : typeof record.message === 'string' ? record.message : undefined;
}

export async function request<T = unknown>(path: string, token?: string, init?: RequestInit, ..._legacyArgs: unknown[]): Promise<T> {
  void _legacyArgs;
  if (!baseUrl) throw new ApiError(0, 'Set VITE_API_BASE_URL to connect the TMS API.');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } });
  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => null);
    const message = response.status === 403 ? 'Microsoft sign-in worked, but your account has not been granted TMS API access yet.' : errorMessage(errorPayload) || `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }
  const payload: unknown = await response.json();
  return payload as T;
}

export interface TmsApi {
  customers(token?: string): Promise<Customer[]>;
  customerContacts(token?: string): Promise<CustomerContact[]>;
  vehicles(token?: string): Promise<Vehicle[]>;
  updateVehicle(id: string, payload: Omit<Vehicle, 'id'>, token?: string): Promise<Vehicle>;
  drivers(token?: string): Promise<Driver[]>;
  trailers(token?: string): Promise<Trailer[]>;
  sites(token?: string): Promise<Site[]>;
  marketContacts(token?: string): Promise<MarketContact[]>;
  fuelPrices(token?: string): Promise<FuelPrice[]>;
  saveFuelPrice(payload: { weekCommencing: string; provider: string; pricePencePerLitre: number; isPricingMaximum: boolean; source?: string; notes?: string }, token?: string): Promise<FuelPrice>;
  staging(token?: string, status?: string, entityType?: string, take?: number): Promise<StagedImport[]>;
  orders(from?: string, to?: string, token?: string): Promise<TransportOrder[]>;
  stageOrder(payload: Record<string, string>, idempotencyKey: string, token?: string): Promise<StageImportResponse>;
  stageRecord(entityType: string, payload: Record<string, string | boolean | number | undefined>, idempotencyKey: string, token?: string): Promise<StageImportResponse>;
  stageBatch(records: StageBatchRequest[], token?: string): Promise<StageBatchResponse>;
  applyMasterData(records: StageBatchRequest[], token?: string): Promise<MasterApplyResponse>;
  linkMasterRegister(token?: string): Promise<{ linked: number; message: string }>;
  telemetry(token?: string): Promise<Telemetry>;
  fleetStatus(token?: string): Promise<FleetStatus>;
  trackingHistory(date: string, token?: string): Promise<Telemetry>;
  operationsReconciliation(date: string, token?: string): Promise<UnknownRecord>;
  operationsExceptions(date: string, token?: string): Promise<UnknownRecord>;
  driverAssignments(from: string, to: string, token?: string): Promise<DriverAssignment[]>;
  returnLoadSuggestions(date: string, token?: string): Promise<ReturnLoadSuggestions>;
  deliveryEtas(date: string, token?: string): Promise<DeliveryEtas>;
  sendDispatchSms(loadId: string, token?: string): Promise<DispatchSmsResponseDto>;
  geocode(address: string, token?: string): Promise<Record<string, unknown>>;
  sageHrStatus(token?: string): Promise<SageHrStatus>;
  roadTechStatus(token?: string): Promise<RoadTechStatus>;
  fleetioStatus(token?: string): Promise<FleetioStatus>;
  fleetioVehicleAlignment(token?: string): Promise<FleetioVehicleAlignment>;
  syncFleetioVehicles(token?: string): Promise<FleetioSync>;
  integrationStatus(token?: string): Promise<IntegrationStatus>;
  diagnosticsTables(token?: string): Promise<DiagnosticsTables>;
  syncSageHrDrivers(token?: string): Promise<SageHrSync>;
  review(id: string, approved: boolean, note: string, token?: string): Promise<unknown>;
  clearPendingStaging(token?: string): Promise<{ deleted: number }>;
  assistantSnapshot(date: string, token?: string): Promise<AssistantSnapshot>;
  assistantAdvice(message: string, date: string, token?: string): Promise<AssistantAdvice>;
  fixSafeValidations(token?: string): Promise<SafeFixResult>;
}

export const api: TmsApi = {
  customers: token => request<Customer[]>('/api/v1/customers', token),
  customerContacts: token => request<CustomerContact[]>('/api/v1/customer-contacts', token),
  vehicles: token => request<Vehicle[]>('/api/v1/vehicles', token),
  updateVehicle: (id, payload, token) => request<Vehicle>(`/api/v1/vehicles/${id}`, token, { method: 'PUT', body: JSON.stringify(payload) }),
  drivers: token => request<Driver[]>('/api/v1/drivers', token),
  trailers: token => request<Trailer[]>('/api/v1/trailers', token),
  sites: token => request<Site[]>('/api/v1/sites', token),
  marketContacts: async token => normaliseMarketContacts(await request<MarketContact[]>('/api/v1/market-contacts', token)),
  fuelPrices: token => request<FuelPrice[]>('/api/v1/fuel-prices', token),
  saveFuelPrice: (payload, token) => request<FuelPrice>('/api/v1/fuel-prices', token, { method: 'POST', body: JSON.stringify(payload) }),
  staging: (token, status = 'PendingReview', entityType = '', take = 1000) => request<StagedImport[]>(`/api/v1/staging?take=${take}${status ? `&status=${encodeURIComponent(status)}` : ''}${entityType ? `&entityType=${encodeURIComponent(entityType)}` : ''}`, token),
  orders: (from, to, token) => request<TransportOrder[]>(`/api/v1/orders?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`, token),
  stageOrder: (payload, idempotencyKey, token) => request<StageImportResponse>('/api/v1/staging', token, { method: 'POST', body: JSON.stringify({ entityType: 'order', idempotencyKey, source: 'SLH TMS Web/CSV', payload }) }),
  stageRecord: (entityType, payload, idempotencyKey, token) => request<StageImportResponse>('/api/v1/staging', token, { method: 'POST', body: JSON.stringify({ entityType, idempotencyKey, source: 'SLH TMS Web', payload }) }),
  stageBatch: (records, token) => request<StageBatchResponse>('/api/v1/staging/batch', token, { method: 'POST', body: JSON.stringify(normaliseMarketMasterRecords(records)) }),
  applyMasterData: (records, token) => request<MasterApplyResponse>('/api/v1/master-data/apply', token, { method: 'POST', body: JSON.stringify(normaliseMarketMasterRecords(records)) }),
  linkMasterRegister: token => request<{ linked: number; message: string }>('/api/v1/master-data/register/link', token, { method: 'POST' }),
  telemetry: token => request<Telemetry>('/api/v1/tracking/dot/telemetry', token),
  fleetStatus: token => request<FleetStatus>('/api/v1/tracking/dot/fleet-status', token),
  trackingHistory: (date, token) => request<Telemetry>(`/api/v1/tracking/dot/history?date=${encodeURIComponent(date)}`, token),
  operationsReconciliation: (date, token) => request<UnknownRecord>(`/api/v1/operations/reconciliation?date=${encodeURIComponent(date)}`, token),
  operationsExceptions: (date, token) => request<UnknownRecord>(`/api/v1/operations/exceptions?date=${encodeURIComponent(date)}`, token),
  driverAssignments: (from, to, token) => request<DriverAssignment[]>(`/api/v1/driver-assignments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token),
  returnLoadSuggestions: (date, token) => request<ReturnLoadSuggestions>(`/api/v1/planning/return-load-suggestions?date=${encodeURIComponent(date)}`, token),
  deliveryEtas: (date, token) => request<DeliveryEtas>(`/api/v1/operations/delivery-etas?date=${encodeURIComponent(date)}`, token),
  sendDispatchSms: (loadId, token) => request<DispatchSmsResponseDto>(`/api/v1/loads/${loadId}/dispatch/sms`, token, { method: 'POST' }),
  geocode: (address, token) => geocodeAddress(address, token),
  sageHrStatus: token => request<SageHrStatus>('/api/v1/integrations/sage-hr/status', token),
  roadTechStatus: token => request<RoadTechStatus>('/api/v1/integrations/roadtech/status', token),
  fleetioStatus: token => request<FleetioStatus>('/api/v1/integrations/fleetio/status', token),
  fleetioVehicleAlignment: token => request<FleetioVehicleAlignment>('/api/v1/integrations/fleetio/vehicle-alignment', token),
  syncFleetioVehicles: token => request<FleetioSync>('/api/v1/integrations/fleetio/sync-assets-resilient', token, { method: 'POST' }),
  integrationStatus: token => request<IntegrationStatus>('/api/v1/integrations/status', token),
  diagnosticsTables: token => request<DiagnosticsTables>('/api/v1/diagnostics/tables', token),
  syncSageHrDrivers: token => request<SageHrSync>('/api/v1/integrations/sage-hr/sync-drivers', token, { method: 'POST' }),
  review: (id, approved, note, token) => request(`/api/v1/staging/${id}/${approved ? 'approve' : 'reject'}`, token, { method: 'POST', body: JSON.stringify({ note }) }),
  clearPendingStaging: token => request<{ deleted: number }>('/api/v1/staging/pending?confirm=CLEAR-PENDING', token, { method: 'DELETE' }),
  assistantSnapshot: (date, token) => request<AssistantSnapshot>(`/api/v1/assistant/snapshot?date=${encodeURIComponent(date)}`, token),
  assistantAdvice: (message, date, token) => request<AssistantAdvice>('/api/v1/assistant/advice', token, { method: 'POST', body: JSON.stringify({ message, date }) }),
  fixSafeValidations: token => request<SafeFixResult>('/api/v1/assistant/fix-safe-validations', token, { method: 'POST' }),
};
