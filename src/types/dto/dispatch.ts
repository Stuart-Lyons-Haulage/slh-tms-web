export type DispatchStatus = 'Draft' | 'Planned' | 'Unallocated' | 'Allocated' | 'Ready' | 'Dispatched' | 'OnRoute' | 'Completed' | 'Cancelled' | string;

export interface DispatchDriverDto {
  displayName: string;
  employeeNumber: string;
  mobileNumber?: string;
}

export interface DispatchVehicleDto {
  registration: string;
  fleetNumber?: string;
  fuelProvider?: string;
  fuelPin?: string;
  shellCard?: string;
  bpRedCard?: string;
  bpPlainCard?: string;
  fuelCardLastFour?: string;
}

export interface DispatchTrailerDto {
  trailerNumber: string;
  type?: string;
}

export interface DispatchOrderDto {
  reference: string;
  customerCode: string;
  pallets?: number;
  collectionDate?: string;
  deliveryDate?: string;
  sellerName?: string;
  marketName?: string;
  stallNumber?: string;
  driverInstructions?: string;
  mapLink?: string;
  deliveryName?: string;
}

export interface DispatchStopDto {
  sequence: number;
  name: string;
  address?: string;
  order?: DispatchOrderDto;
}

export interface RunDispatchDto {
  reference: string;
  planningDate: string;
  status: DispatchStatus;
  driver?: DispatchDriverDto;
  vehicle?: DispatchVehicleDto;
  trailer?: DispatchTrailerDto;
  stops: DispatchStopDto[];
}

export interface DispatchSmsResponseDto {
  messageId: string;
  mobileSuffix: string;
  provider?: string;
  status: string;
}
