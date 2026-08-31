export interface DriverDto {
  id: string;
  employeeNumber: string;
  displayName: string;
  tachoName?: string;
  tachoMasterDriverId?: string;
  tachoCardNumber?: string;
  lastTachoSyncUtc?: string;
  mobileNumber?: string;
  driverType?: string;
  driverGroup?: string;
  skills?: string;
  tachoDriveAvailableTodayMinutes?: number;
  tachoDriveAvailableWeekMinutes?: number;
  tachoWorkAvailableWeekMinutes?: number;
  active: boolean;
}

export interface VehicleDto {
  id: string;
  registration: string;
  fleetNumber?: string;
  abbreviation?: string;
  transmission?: string;
  dvsCompliant?: boolean;
  fuelProvider?: string;
  cabMobile?: string;
  notes?: string;
  fuelPinSecretName?: string;
  fuelCardLastFour?: string;
  fleetioId?: string;
  fleetioName?: string;
  fleetioStatus?: string;
  trackingIdentifier?: string;
  active: boolean;
}

export interface RunAllocationDto {
  vehicleId?: string;
  driverId?: string;
  trailerId?: string;
}

export interface DriverAssignmentDto {
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
}
