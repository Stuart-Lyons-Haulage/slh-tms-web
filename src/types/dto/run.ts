export interface RunStopDto {
  id: string;
  orderId?: string;
  sequence: number;
  name: string;
  address?: string;
  siteId?: string;
  stopType?: string;
  status?: string;
  latitude?: number;
  longitude?: number;
  plannedArrivalUtc?: string;
  plannedDepartureUtc?: string;
  actualArrivalUtc?: string;
  actualDepartureUtc?: string;
  pallets?: number;
  cases?: number;
  trays?: number;
  trolleys?: number;
  notes?: string;
}

export interface RunDto {
  id: string;
  reference: string;
  rawReference?: string;
  planningDate: string;
  status: string;
  vehicleId?: string;
  driverId?: string;
  trailerId?: string;
  routeName?: string;
  wave?: string;
  startTime?: string;
  signOnTime?: string;
  overnight?: boolean;
  nightOutRequired?: boolean;
  palletSpacesUsed?: number;
  totalPalletSpaces?: number;
  capacityType?: string;
  plannerNotes?: string;
  notes?: string;
  stops: RunStopDto[];
}

export interface CreateRunStopDto {
  orderId?: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  plannedArrivalUtc?: string;
}

export interface CreateRunDto {
  reference: string;
  planningDate: string;
  vehicleId?: string;
  driverId?: string;
  trailerId?: string;
  palletSpacesUsed?: number;
  totalPalletSpaces?: number;
  capacityType?: string;
  plannerNotes?: string;
  overnight?: boolean;
  notes?: string;
  stops: CreateRunStopDto[];
}

export interface RunOperationalUpdateDto {
  vehicleId?: string;
  driverId?: string;
  trailerId?: string;
  palletSpacesUsed?: number;
  totalPalletSpaces?: number;
  capacityType?: string;
  plannerNotes?: string;
  overnight?: boolean;
  nightOutRequired?: boolean;
  notes?: string;
}
