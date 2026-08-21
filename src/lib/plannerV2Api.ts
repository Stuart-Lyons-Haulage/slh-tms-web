import { request } from "./api";

export type PlannerDaySuggestion = {
  driverId: string;
  driverName: string;
  employeeNumber: string;
  previousLoadId: string;
  previousLoadReference: string;
  previousPlanningDate: string;
  lastLocation: string;
  lastLatitude?: number;
  lastLongitude?: number;
  orderId: string;
  orderReference: string;
  customerCode: string;
  collectionSite: string;
  destination: string;
  orderType: string;
  quantity?: number;
  repositionMiles?: number;
  driveAvailableTodayMinutes?: number;
  score: number;
  reason: string;
};

export type PlannerDaySuggestions = {
  planningDate: string;
  previousDate: string;
  generatedAtUtc: string;
  unplannedOrders: number;
  previousDayDrivers: number;
  suggestions: PlannerDaySuggestion[];
};

export const plannerV2Api = {
  daySuggestions: (date: string, token?: string) =>
    request<PlannerDaySuggestions>(
      `/api/v1/planning/day-suggestions?date=${encodeURIComponent(date)}`,
      token,
    ),
};
