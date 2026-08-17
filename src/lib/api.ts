export type Customer = {
  id: string;
  code: string;
  name: string;
  active: boolean;
};
export type CustomerContact = {
  id: string;
  customerCode: string;
  name: string;
  email?: string;
  mobileNumber?: string;
  receivesEtaUpdates: boolean;
  active: boolean;
};
export type Vehicle = {
  id: string;
  registration: string;
  fleetNumber?: string;
  abbreviation?: string;
  transmission?: string;
  dvsCompliant?: boolean;
  fuelProvider?: string;
  cabMobile?: string;
  fuelPin?: string;
  shellCard?: string;
  bpRedCard?: string;
  bpPlainCard?: string;
  notes?: string;
  fuelPinSecretName?: string;
  fuelCardLastFour?: string;
  fleetioId?: string;
  fleetioName?: string;
  fleetioStatus?: string;
  fleetioVor?: boolean;
  fleetioPmiDueUtc?: string;
  fleetioMotDueUtc?: string;
  fleetioServiceStatus?: string;
  fleetioLastSyncedUtc?: string;
  active: boolean;
};
export type Driver = {
  id: string;
  employeeNumber: string;
  displayName: string;
  tachoName?: string;
  mobileNumber?: string;
  driverType?: string;
  driverGroup?: string;
  skills?: string;
  coding?: string;
  agencyName?: string;
  northEligible?: boolean;
  preloadEligible?: boolean;
  notes?: string;
  tachoMasterDriverId?: string;
  tachoCardNumber?: string;
  tachoDriveAvailableTodayMinutes?: number;
  tachoDriveAvailableWeekMinutes?: number;
  tachoWorkAvailableWeekMinutes?: number;
  drivingLicenceNumber?: string;
  licenceExpiry?: string;
  licenceStatus?: string;
  lastTachoSyncUtc?: string;
  active: boolean;
};
export type Trailer = {
  id: string;
  trailerNumber: string;
  type?: string;
  standardCapacity?: number;
  euroCapacity?: number;
  notes?: string;
  active: boolean;
};
export type Site = {
  id: string;
  externalCode: string;
  name: string;
  driverTextName?: string;
  aliases?: string;
  collectionAddress?: string;
  collectionInstructions?: string;
  mapLink?: string;
  latitude?: number;
  longitude?: number;
  customField1?: string;
  customField2?: string;
  customField3?: string;
  active: boolean;
};
export type MarketContact = {
  id: string;
  market: string;
  name: string;
  standOrLocation?: string;
  salesman?: string;
  sender?: string;
  active: boolean;
};
export type FuelPrice = {
  id: string;
  weekCommencing: string;
  provider: string;
  pricePencePerLitre: number;
  isPricingMaximum: boolean;
  source?: string;
  notes?: string;
  createdAtUtc: string;
};
export type StagedImport = {
  id: string;
  entityType: string;
  idempotencyKey: string;
  payloadJson: string;
  status: string | number;
  source?: string;
  receivedAtUtc: string;
  reviewedAtUtc?: string;
  reviewedBy?: string;
  reviewNote?: string;
};
export type TransportOrder = {
  id: string;
  reference: string;
  customerCode: string;
  collectionDate: string;
  deliveryDate?: string;
  deliveryWindowStartUtc?: string;
  deliveryWindowEndUtc?: string;
  pallets?: number;
  status: string;
  sellerName?: string;
  marketName?: string;
  stallNumber?: string;
  driverInstructions?: string;
  mapLink?: string;
};
export type Telemetry = {
  provider: string;
  retrievedAtUtc: string;
  recordCount: number;
  records: Array<{
    vehicleIdentifier: string;
    eventTimeUtc: string;
    latitude?: number;
    longitude?: number;
    speedKph?: number;
    isMoving?: boolean;
    status?: string;
  }>;
};
export type TachoVehicleDriverStatus = {
  vehicleCode: string;
  memberCode: number;
  driverName: string;
  cardNumber?: string;
  employeeNumber?: string;
  dutyStartUtc: string;
  dutyEndUtc?: string;
  workMinutes: number;
  restMinutes: number;
  availableMinutes: number;
  driveMinutes: number;
  breakCount: number;
  breakMinutes?: number;
  metricsValidAtUtc?: string;
  dailyDriverPeriodsAvailable?: number;
  driveAvailableTodayMinutes?: number;
  driveAvailableTomorrowMinutes?: number;
  driveAvailableWeekMinutes?: number;
  driveAvailableFortnightMinutes?: number;
  longDaysWorkedThisWeek?: number;
  shortDailyRestTakenThisWeek?: number;
  workAvailableWeekMinutes?: number;
};
export type FleetStatus = {
  provider: string;
  retrievedAtUtc: string;
  vehicleCount: number;
  readyCount: number;
  attentionCount: number;
  vehicles: Array<{
    vehicleId: string;
    registration: string;
    fleetNumber?: string;
    trackingIdentifier?: string;
    condition:
      | "Moving"
      | "Started"
      | "Parked"
      | "Stationary"
      | "SignedOn"
      | "Stale"
      | "NotSignedOn";
    lastEventTimeUtc?: string;
    ignitionOn?: boolean;
    isMoving?: boolean;
    speedKph?: number;
    latitude?: number;
    longitude?: number;
    ageMinutes?: number;
    loadId?: string;
    loadReference?: string;
    loadStatus?: string;
    driverId?: string;
    driverName?: string;
    tachoName?: string;
    driverSource?: "TachoMaster" | "Allocation";
    allocatedDriverName?: string;
    driverMismatch?: boolean;
    plannedDutyUtc?: string;
    tacho?: TachoVehicleDriverStatus;
    fleetioId?: string;
    fleetioName?: string;
    fleetioStatus?: string;
    fleetioVor?: boolean;
    fleetioPmiDueUtc?: string;
    fleetioMotDueUtc?: string;
    fleetioServiceStatus?: string;
    driverMatchReason?: string;
  }>;
};
export type StageImportResponse = {
  stagingId: string;
  status: string;
  receivedAtUtc: string;
  reviewUrl: string;
};
export type StageBatchRequest = {
  entityType: string;
  idempotencyKey: string;
  source?: string;
  payload: Record<string, string | boolean | number | undefined>;
};
export type StageBatchResponse = {
  received: number;
  existing: number;
  created: number;
  records: StageImportResponse[];
};
export type MasterApplyResponse = {
  received: number;
  applied: number;
  registered?: number;
  failed: number;
  linked?: number;
  results: Array<{
    entityType: string;
    idempotencyKey?: string;
    applied: boolean;
    registered?: boolean;
    error?: string;
  }>;
};
export type LoadStop = {
  id: string;
  orderId?: string;
  sequence: number;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  plannedArrivalUtc?: string;
};
export type Load = {
  id: string;
  reference: string;
  planningDate: string;
  status: string;
  vehicleId?: string;
  driverId?: string;
  trailerId?: string;
  revenueAmount?: number;
  fuelSurchargeAmount?: number;
  estimatedCostAmount?: number;
  actualCostAmount?: number;
  estimatedDistanceMiles?: number;
  emptyMiles?: number;
  invoiceStatus?: string;
  commercialNotes?: string;
  palletSpacesUsed?: number;
  totalPalletSpaces?: number;
  capacityType?: string;
  depotSplits?: string;
  temperatureC?: number;
  plannerNotes?: string;
  utilisationPercent?: number;
  stops: LoadStop[];
};
export type LoadDispatch = {
  reference: string;
  planningDate: string;
  status: string;
  driver?: {
    displayName: string;
    employeeNumber: string;
    mobileNumber?: string;
  };
  vehicle?: { registration: string; fleetNumber?: string };
  trailer?: { trailerNumber: string; type?: string };
  stops: Array<{
    sequence: number;
    name: string;
    address?: string;
    order?: {
      reference: string;
      customerCode: string;
      sellerName?: string;
      marketName?: string;
      stallNumber?: string;
      driverInstructions?: string;
      mapLink?: string;
    };
  }>;
};
export type CreateLoad = {
  reference: string;
  planningDate: string;
  vehicleId?: string;
  driverId?: string;
  trailerId?: string;
  palletSpacesUsed?: number;
  totalPalletSpaces?: number;
  capacityType?: string;
  depotSplits?: string;
  temperatureC?: number;
  plannerNotes?: string;
  stops: Array<{
    orderId?: string;
    name: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    plannedArrivalUtc?: string;
  }>;
};
export type DriverAssignment = {
  loadId: string;
  planningDate: string;
  loadReference: string;
  status: string;
  driver?: { id: string; displayName: string; employeeNumber: string };
  vehicle?: { id: string; registration: string; fleetNumber?: string };
  trailerNumber?: string;
  stopCount: number;
  finalStop?: string;
  finalLatitude?: number;
  finalLongitude?: number;
};
export type ReturnLoadSuggestion = {
  driverId: string;
  driverName: string;
  employeeNumber: string;
  consecutiveDays: number;
  previousLoadReference: string;
  previousPlanningDate: string;
  lastLocation?: string;
  latitude?: number;
  longitude?: number;
  suggestedLoadId?: string;
  suggestedLoadReference?: string;
  priority: number;
  reason: string;
};
export type ReturnLoadSuggestions = {
  planningDate: string;
  generatedAtUtc: string;
  suggestions: ReturnLoadSuggestion[];
};
export type SageHrStatus = {
  configured: boolean;
  connected: boolean;
  employeeCount: number;
  driverCandidateCount: number;
  missingSettings?: string[];
  message: string;
};
export type RoadTechStatus = {
  configured: boolean;
  connected: boolean;
  recordCount: number;
  latestEventUtc?: string;
  missingSettings?: string[];
  message: string;
};
export type TachoMasterStatus = {
  configured: boolean;
  connected: boolean;
  matchedVehicleCount: number;
  missingSettings?: string[];
  message: string;
};
export type SageHrSync = {
  sourceEmployeeCount: number;
  driverCandidateCount: number;
  created: number;
  updated: number;
  skipped: number;
  syncedAtUtc: string;
  connected?: boolean;
  message?: string;
};
export type DeliveryEta = {
  loadId: string;
  loadReference: string;
  loadStatus: string;
  stopId: string;
  sequence: number;
  stopName: string;
  orderReference?: string;
  customerCode?: string;
  vehicleRegistration?: string;
  etaUtc?: string;
  source: "Live" | "Planned" | "Unavailable";
  deliveryWindowStartUtc?: string;
  deliveryWindowEndUtc?: string;
  risk: "Pending" | "Late" | "AtRisk" | "OnTrack";
  trackingUpdatedAtUtc?: string;
  tachoDriverName?: string;
  driveAvailableTodayMinutes?: number;
  routeDrivingMinutes: number;
  breakMinutesIncluded: number;
  tachoStatus:
    | "Unavailable"
    | "RouteUnavailable"
    | "WithinDriveTime"
    | "BreakIncluded"
    | "InsufficientDriveTime";
  tachoExplanation: string;
};
export type DeliveryEtas = {
  planningDate: string;
  calculatedAtUtc: string;
  records: DeliveryEta[];
};
export type ForecastDay = {
  date: string;
  loads: number;
  assignedDrivers: number;
  availableDrivers: number;
  assignedVehicles: number;
  availableVehicles: number;
  plannedPallets: number;
  availableTrailerPallets: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPercent?: number;
  distanceMiles: number;
  emptyMiles: number;
  emptyMilePercent?: number;
  unpricedLoads: number;
  uninvoicedLoads: number;
  exceptions: number;
  utilisationPercent?: number;
  overCapacityLoads: number;
};
export type OperationsForecast = {
  from: string;
  to: string;
  generatedAtUtc: string;
  activeDrivers: number;
  activeVehicles: number;
  days: ForecastDay[];
  totals: {
    loads: number;
    revenue: number;
    cost: number;
    margin: number;
    emptyMiles: number;
    exceptions: number;
    plannedPallets: number;
    availableTrailerPallets: number;
    utilisationPercent?: number;
    overCapacityLoads: number;
  };
};
export type IntegrationStatus = {
  roadTech: {
    configured: boolean;
    connected: boolean;
    latestEventUtc?: string;
  };
  tachoMaster?: { configured: boolean; missingSettings?: string[] };
  azureMaps: { configured: boolean };
  azureSms: { configured: boolean };
  textBee?: {
    configured: boolean;
    dutyPhoneLabel?: string;
    missingSettings?: string[];
  };
  fleetio?: { configured: boolean; missingSettings?: string[] };
  sageHr: { configured: boolean };
  emailIntake: { configured: boolean; lastReceivedUtc?: string };
  assistant?: {
    configured: boolean;
    model: string;
    safeRulesAvailable: boolean;
  };
  batchIntake: { configured: boolean; endpoint: string };
};
export type FleetioStatus = {
  configured: boolean;
  connected: boolean;
  sampleVehicleCount: number;
  missingSettings?: string[];
  message: string;
};
export type FleetioSync = {
  sourceVehicleCount: number;
  tmsVehicleCount: number;
  updated: number;
  created?: number;
  missingInFleetio: number;
  syncedAtUtc: string;
  connected?: boolean;
  message?: string;
};
export type FleetioVehicleAlignment = {
  configured: boolean;
  connected: boolean;
  matched: number;
  unmatchedFleetio: number;
  missingInFleetio: number;
  missingSettings?: string[];
  message: string;
  records: Array<{
    tmsVehicleId?: string;
    tmsRegistration?: string;
    tmsFleetNumber?: string;
    tmsAbbreviation?: string;
    fleetioId?: string;
    fleetioRegistration?: string;
    fleetioName?: string;
    fleetioFleetNumber?: string;
    fleetioStatus?: string;
    fleetioVor?: boolean;
    pmiDueUtc?: string;
    motDueUtc?: string;
    serviceStatus?: string;
    status: "Matched" | "MissingInFleetio" | "UnmatchedFleetio";
  }>;
};
export type DiagnosticsTables = Record<
  string,
  { ok: boolean; count?: number; error?: string }
>;
export type MasterDataSuggestions = {
  generatedAtUtc: string;
  source: string;
  suggestions: Array<{
    severity: string;
    entity: string;
    key: string;
    message: string;
  }>;
};
export type AssistantSuggestion = {
  id: string;
  severity: "high" | "medium" | "low" | "info";
  title: string;
  detail: string;
  area: string;
  autoFixAvailable: boolean;
};
export type AssistantSnapshot = {
  planningDate: string;
  generatedAtUtc: string;
  source: string;
  aiConfigured: boolean;
  metrics: {
    orders: number;
    unplannedOrders: number;
    loads: number;
    unallocatedLoads: number;
    activeDrivers: number;
    activeVehicles: number;
    vehicleComplianceRisks: number;
    unpricedLoads: number;
    negativeMarginLoads: number;
    emptyMiles: number;
    missingSiteMapPoints: number;
    duplicateSiteGroups: number;
  };
  suggestions: AssistantSuggestion[];
};
export type AssistantAdvice = {
  answer: string;
  source: string;
  suggestions: AssistantSuggestion[];
};
export type SafeFixResult = {
  applied: number;
  skipped: number;
  changes: string[];
  skippedReasons: string[];
};
export type IntegrationConfidence = {
  generatedAtUtc: string;
  sageHr: {
    configured: boolean;
    activeDrivers: number;
    driversWithoutTachoName: number;
    lastSyncUtc?: string;
    lastSyncSummary?: string;
  };
  tachoMaster: {
    configured: boolean;
    driversWithTachoSync: number;
    driversWithoutTachoName: number;
    lastSyncUtc?: string;
  };
  dotTracking: {
    configured: boolean;
    liveVehicleCount: number;
    staleVehicleCount: number;
    latestEventUtc?: string;
    trackingAgeMinutes?: number;
  };
  fleetio: {
    configured: boolean;
    matchedVehicles: number;
    unmatchedVehicles: number;
  };
  emailIntake: {
    lastReceivedUtc?: string;
    pendingReview: number;
  };
};
export type ExceptionRecord = {
  type: string;
  severity: "High" | "Medium" | "Low";
  reference: string;
  description: string;
  loadId?: string;
};
export type OperationsExceptions = {
  planningDate: string;
  generatedAtUtc: string;
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  byType: Record<string, number>;
  exceptions: ExceptionRecord[];
};
export type Reconciliation = {
  planningDate: string;
  generatedAtUtc: string;
  orders: {
    total: number;
    readyToPlan: number;
    planned: number;
    inTransit: number;
    delivered: number;
  };
  loads: {
    total: number;
    planned: number;
    dispatched: number;
    completed: number;
    unallocated: number;
  };
  fleet: {
    activeDrivers: number;
    assignedDrivers: number;
    unassignedDrivers: number;
    activeVehicles: number;
    assignedVehicles: number;
    vehiclesSeenToday: number;
    vehiclesNoSignal: number;
  };
  staging: {
    pendingReview: number;
  };
};
export type IntegrationMapping = {
  id: string;
  provider: string;
  externalKey: string;
  externalLabel?: string;
  tmsEntityType: string;
  tmsEntityId: string;
  active: boolean;
  notes?: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  updatedBy?: string;
};
export type DriverStatusLog = {
  id: string;
  loadId: string;
  driverId?: string;
  status: string;
  notes?: string;
  capturedBy?: string;
  capturedAtUtc: string;
};

const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/tms-api").replace(
  /\/$/,
  "",
);
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  token?: string,
  init?: RequestInit,
  timeoutMs = 25000,
): Promise<T> {
  if (!baseUrl)
    throw new ApiError(0, "Set VITE_API_BASE_URL to connect the TMS API.");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch (exception) {
    if (exception instanceof DOMException && exception.name === "AbortError")
      throw new ApiError(
        0,
        "The TMS service took too long to respond. The rest of the page is still available; retry this panel.",
      );
    throw exception;
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const message =
      response.status === 403
        ? "Microsoft sign-in worked, but your account has not been granted TMS API access yet."
        : error?.detail ||
          error?.message ||
          `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  customers: (token?: string) =>
    request<Customer[]>("/api/v1/customers", token),
  updateCustomer: (id: string, payload: Omit<Customer, "id">, token?: string) =>
    request<Customer>(`/api/v1/customers/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  customerContacts: (token?: string) =>
    request<CustomerContact[]>("/api/v1/customer-contacts", token),
  updateCustomerContact: (id: string, payload: Omit<CustomerContact, "id">, token?: string) =>
    request<CustomerContact>(`/api/v1/customer-contacts/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  vehicles: (token?: string) => request<Vehicle[]>("/api/v1/vehicles", token),
  updateVehicle: (id: string, payload: Omit<Vehicle, "id">, token?: string) =>
    request<Vehicle>(`/api/v1/vehicles/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  drivers: (token?: string) => request<Driver[]>("/api/v1/drivers", token),
  updateDriver: (
    id: string,
    payload: Omit<Driver, "id" | "lastTachoSyncUtc">,
    token?: string,
  ) =>
    request<Driver>(`/api/v1/drivers/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  trailers: (token?: string) => request<Trailer[]>("/api/v1/trailers", token),
  updateTrailer: (id: string, payload: Omit<Trailer, "id">, token?: string) =>
    request<Trailer>(`/api/v1/trailers/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  sites: (token?: string) => request<Site[]>("/api/v1/sites", token),
  updateSite: (id: string, payload: Omit<Site, "id">, token?: string) =>
    request<Site>(`/api/v1/sites/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  marketContacts: (token?: string) =>
    request<MarketContact[]>("/api/v1/market-contacts", token),
  fuelPrices: (token?: string) =>
    request<FuelPrice[]>("/api/v1/fuel-prices", token),
  saveFuelPrice: (
    payload: {
      weekCommencing: string;
      provider: string;
      pricePencePerLitre: number;
      isPricingMaximum: boolean;
      source?: string;
      notes?: string;
    },
    token?: string,
  ) =>
    request<FuelPrice>("/api/v1/fuel-prices", token, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  staging: (
    token?: string,
    status = "PendingReview",
    entityType = "",
    take = 1000,
  ) =>
    request<StagedImport[]>(
      `/api/v1/staging?take=${take}${status ? `&status=${encodeURIComponent(status)}` : ""}${entityType ? `&entityType=${encodeURIComponent(entityType)}` : ""}`,
      token,
    ),
  orders: (from?: string, to?: string, token?: string) =>
    request<TransportOrder[]>(
      `/api/v1/orders?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`,
      token,
    ),
  stageOrder: (
    payload: Record<string, string>,
    idempotencyKey: string,
    token?: string,
  ) =>
    request<StageImportResponse>("/api/v1/staging", token, {
      method: "POST",
      body: JSON.stringify({
        entityType: "order",
        idempotencyKey,
        source: "SLH TMS Web/CSV",
        payload,
      }),
    }),
  stageRecord: (
    entityType: string,
    payload: Record<string, string | boolean | number | undefined>,
    idempotencyKey: string,
    token?: string,
  ) =>
    request<StageImportResponse>("/api/v1/staging", token, {
      method: "POST",
      body: JSON.stringify({
        entityType,
        idempotencyKey,
        source: "SLH TMS Web",
        payload,
      }),
    }),
  stageBatch: (records: StageBatchRequest[], token?: string) =>
    request<StageBatchResponse>("/api/v1/staging/batch", token, {
      method: "POST",
      body: JSON.stringify(records),
    }),
  applyMasterData: (records: StageBatchRequest[], token?: string) =>
    request<MasterApplyResponse>(
      "/api/v1/master-data/apply",
      token,
      { method: "POST", body: JSON.stringify(records) },
      60000,
    ),
  linkMasterRegister: (token?: string) =>
    request<{ linked: number; message: string }>(
      "/api/v1/master-data/register/link",
      token,
      { method: "POST" },
    ),
  telemetry: (token?: string) =>
    request<Telemetry>("/api/v1/tracking/dot/telemetry", token),
  fleetStatus: (token?: string) =>
    request<FleetStatus>("/api/v1/tracking/dot/fleet-status", token),
  trackingHistory: (date: string, token?: string) =>
    request<Telemetry>(
      `/api/v1/tracking/dot/history?date=${encodeURIComponent(date)}`,
      token,
    ),
  loads: (date?: string, token?: string) =>
    request<Load[]>(`/api/v1/loads${date ? `?date=${date}` : ""}`, token),
  driverAssignments: (from: string, to: string, token?: string) =>
    request<DriverAssignment[]>(
      `/api/v1/driver-assignments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      token,
    ),
  returnLoadSuggestions: (date: string, token?: string) =>
    request<ReturnLoadSuggestions>(
      `/api/v1/planning/return-load-suggestions?date=${encodeURIComponent(date)}`,
      token,
    ),
  deliveryEtas: (date: string, token?: string) =>
    request<DeliveryEtas>(
      `/api/v1/operations/delivery-etas?date=${encodeURIComponent(date)}`,
      token,
    ),
  operationsForecast: (from: string, token?: string) =>
    request<OperationsForecast>(
      `/api/v1/operations/forecast?from=${encodeURIComponent(from)}`,
      token,
    ),
  createLoad: (payload: CreateLoad, token?: string) =>
    request<Load>("/api/v1/loads", token, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  allocateLoad: (
    id: string,
    payload: { vehicleId?: string; driverId?: string; trailerId?: string },
    token?: string,
  ) =>
    request<Load>(`/api/v1/loads/${id}/allocation`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  updateLoadCommercial: (
    id: string,
    payload: {
      revenueAmount?: number;
      fuelSurchargeAmount?: number;
      estimatedCostAmount?: number;
      actualCostAmount?: number;
      estimatedDistanceMiles?: number;
      emptyMiles?: number;
      invoiceStatus?: string;
      commercialNotes?: string;
    },
    token?: string,
  ) =>
    request<Load>(`/api/v1/loads/${id}/commercial`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  updateLoadUtilisation: (
    id: string,
    payload: {
      palletSpacesUsed?: number;
      totalPalletSpaces?: number;
      capacityType?: string;
      depotSplits?: string;
      temperatureC?: number;
      plannerNotes?: string;
    },
    token?: string,
  ) =>
    request<Load>(`/api/v1/loads/${id}/utilisation`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  updateLoadStatus: (id: string, status: string, token?: string) =>
    request<Load>(`/api/v1/loads/${id}/status`, token, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
  updateLoadStops: (
    id: string,
    stops: Array<{
      orderId?: string;
      name: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      plannedArrivalUtc?: string;
    }>,
    token?: string,
  ) =>
    request<Load>(`/api/v1/loads/${id}/stops`, token, {
      method: "PUT",
      body: JSON.stringify(stops),
    }),
  route: (loadId: string, token?: string) =>
    request<Record<string, unknown>>(`/api/v1/loads/${loadId}/route`, token),
  dispatch: (loadId: string, token?: string) =>
    request<LoadDispatch>(`/api/v1/loads/${loadId}/dispatch`, token),
  sendDispatchSms: (loadId: string, token?: string) =>
    request<{
      messageId: string;
      mobileSuffix: string;
      provider?: string;
      status: string;
    }>(`/api/v1/loads/${loadId}/dispatch/sms`, token, { method: "POST" }),
  geocode: (address: string, token?: string) =>
    request<Record<string, unknown>>(
      `/api/v1/maps/geocode?address=${encodeURIComponent(address)}`,
      token,
    ),
  sageHrStatus: (token?: string) =>
    request<SageHrStatus>("/api/v1/integrations/sage-hr/status", token),
  roadTechStatus: (token?: string) =>
    request<RoadTechStatus>("/api/v1/integrations/roadtech/status", token),
  tachoMasterStatus: (token?: string) =>
    request<TachoMasterStatus>(
      "/api/v1/integrations/tachomaster/status",
      token,
    ),
  fleetioStatus: (token?: string) =>
    request<FleetioStatus>("/api/v1/integrations/fleetio/status", token),
  fleetioVehicleAlignment: (token?: string) =>
    request<FleetioVehicleAlignment>(
      "/api/v1/integrations/fleetio/vehicle-alignment",
      token,
    ),
  syncFleetioVehicles: (token?: string) =>
    request<FleetioSync>("/api/v1/integrations/fleetio/sync-vehicles", token, {
      method: "POST",
    }),
  integrationStatus: (token?: string) =>
    request<IntegrationStatus>("/api/v1/integrations/status", token),
  diagnosticsTables: (token?: string) =>
    request<DiagnosticsTables>("/api/v1/diagnostics/tables", token),
  masterDataSuggestions: (token?: string) =>
    request<MasterDataSuggestions>(
      "/api/v1/diagnostics/master-data-suggestions",
      token,
    ),
  assistantSnapshot: (date: string, token?: string) =>
    request<AssistantSnapshot>(
      `/api/v1/assistant/snapshot?date=${encodeURIComponent(date)}`,
      token,
    ),
  assistantAdvice: (message: string, date: string, token?: string) =>
    request<AssistantAdvice>(
      "/api/v1/assistant/advice",
      token,
      { method: "POST", body: JSON.stringify({ message, date }) },
      40000,
    ),
  fixSafeValidations: (token?: string) =>
    request<SafeFixResult>(
      "/api/v1/assistant/fix-safe-validations",
      token,
      { method: "POST" },
      60000,
    ),
  syncSageHrDrivers: (token?: string) =>
    request<SageHrSync>("/api/v1/integrations/sage-hr/sync-drivers", token, {
      method: "POST",
    }),
  syncTachoMasterDrivers: (token?: string) =>
    request<{
      configured: boolean;
      connected: boolean;
      sourceDrivers: number;
      matched: number;
      unmatched: number;
      syncedAtUtc: string;
      message: string;
    }>("/api/v1/integrations/tachomaster/sync-drivers", token, {
      method: "POST",
    }),
  review: (id: string, approved: boolean, note: string, token?: string) =>
    request(`/api/v1/staging/${id}/${approved ? "approve" : "reject"}`, token, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  clearPendingStaging: (token?: string) =>
    request<{ deleted: number }>(
      "/api/v1/staging/pending?confirm=CLEAR-PENDING",
      token,
      { method: "DELETE" },
    ),
  operationsConfidence: (token?: string) =>
    request<IntegrationConfidence>(
      "/api/v1/operations/confidence",
      token,
    ),
  operationsExceptions: (date: string, token?: string) =>
    request<OperationsExceptions>(
      `/api/v1/operations/exceptions?date=${encodeURIComponent(date)}`,
      token,
    ),
  operationsReconciliation: (date: string, token?: string) =>
    request<Reconciliation>(
      `/api/v1/operations/reconciliation?date=${encodeURIComponent(date)}`,
      token,
    ),
  integrationMappings: (provider: string | undefined, token?: string) =>
    request<IntegrationMapping[]>(
      `/api/v1/operations/mappings${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`,
      token,
    ),
  createMapping: (
    payload: {
      provider: string;
      externalKey: string;
      externalLabel?: string;
      tmsEntityType: string;
      tmsEntityId: string;
      notes?: string;
    },
    token?: string,
  ) =>
    request<IntegrationMapping>("/api/v1/operations/mappings", token, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteMapping: (id: string, token?: string) =>
    request<{ deleted: boolean }>(`/api/v1/operations/mappings/${id}`, token, {
      method: "DELETE",
    }),
  driverStatusLogs: (loadId: string, token?: string) =>
    request<DriverStatusLog[]>(
      `/api/v1/operations/loads/${loadId}/driver-status`,
      token,
    ),
  captureDriverStatus: (
    loadId: string,
    payload: { status: string; driverId?: string; notes?: string },
    token?: string,
  ) =>
    request<DriverStatusLog>(
      `/api/v1/operations/loads/${loadId}/driver-status`,
      token,
      { method: "POST", body: JSON.stringify(payload) },
    ),
};
