import type { PlannerCsvPayload } from "./plannerCsvImport";

export type BetaPlannerStopRequest = {
  name: string;
  orderKey?: string;
  reference?: string;
  pallets?: number;
  role?: "Collection" | "Delivery";
};
export type BetaPlannerRouteRequest = { reference: string; stops: BetaPlannerStopRequest[] };
export type BetaPlannerComparisonRequest = { planningDate: string; routes: BetaPlannerRouteRequest[] };

export type BetaOptimiserStop = { sequence: number; name: string; orderId?: string };
export type BetaOptimiserRoute = {
  loadId: string;
  reference: string;
  status: string;
  isProtected: boolean;
  driver?: string;
  tachoDriveAvailableMinutes?: number;
  lastTachoSyncUtc?: string;
  vehicle?: string;
  fleetioStatus?: string;
  trailer?: string;
  stopCount: number;
  routingAvailable: boolean;
  routingSource: string;
  currentMiles?: number;
  currentDriveMinutes?: number;
  proposedMiles?: number;
  proposedDriveMinutes?: number;
  savingMiles?: number;
  savingDriveMinutes?: number;
  before: BetaOptimiserStop[];
  after: BetaOptimiserStop[];
  rationale: string;
  warnings: string[];
};

export type BetaOptimiserDay = {
  planningDate: string;
  analysedAtUtc: string;
  routingPolicy: string;
  runCount: number;
  routedRunCount: number;
  unroutedRunCount: number;
  currentMiles: number;
  currentDriveMinutes: number;
  projectedMiles: number;
  projectedDriveMinutes: number;
  savingMiles: number;
  savingDriveMinutes: number;
  routes: BetaOptimiserRoute[];
  warnings: string[];
};

export type BetaPlannerRouteComparison = {
  reference: string;
  stopCount: number;
  routingAvailable: boolean;
  currentMiles?: number;
  currentDriveMinutes?: number;
  proposedMiles?: number;
  proposedDriveMinutes?: number;
  savingMiles?: number;
  savingDriveMinutes?: number;
  before: string[];
  after: string[];
  rationale: string;
  warnings: string[];
};

export type BetaPlannerComparison = {
  planningDate: string;
  analysedAtUtc: string;
  routeCount: number;
  routedRouteCount: number;
  currentMiles: number;
  currentDriveMinutes: number;
  projectedMiles: number;
  projectedDriveMinutes: number;
  savingMiles: number;
  savingDriveMinutes: number;
  routes: BetaPlannerRouteComparison[];
  warnings: string[];
};

export type BetaDayPlanOrder = {
  orderId: string;
  sourceLineId: string;
  reference: string;
  customerCode: string;
  period: string;
  palletType?: string;
  pallets: number;
  collectionName: string;
  deliveryName: string;
};

export type BetaDayPlanRun = {
  reference: string;
  period: string;
  palletFamily: string;
  capacityPallets: number;
  plannedPallets: number;
  utilisationPercent: number;
  routingAvailable: boolean;
  miles?: number;
  driveMinutes?: number;
  orders: BetaDayPlanOrder[];
  stops: Array<{ name: string }>;
  warnings: string[];
};

export type BetaDayPlan = {
  planningDate: string;
  generatedAtUtc: string;
  routingPolicy: string;
  eligibleOrderLines: number;
  plannedOrderLines: number;
  unmappedOrderLines: number;
  runCount: number;
  routedRunCount: number;
  totalPallets: number;
  totalMiles?: number;
  totalDriveMinutes?: number;
  routingComplete: boolean;
  runs: BetaDayPlanRun[];
  warnings: string[];
};

export type BetaDayPlanReconciliation = {
  betaOrderLines: number;
  lyonsOrderLines: number;
  matchedOrderLines: number;
  missingFromLyons: string[];
  onlyInLyons: string[];
  orderCoverageComplete: boolean;
  comparableRouting: boolean;
  runCountDelta: number;
  milesDelta?: number;
  driveMinutesDelta?: number;
  warnings: string[];
};

export type BetaDayPlanComparison = {
  planningDate: string;
  beta: BetaDayPlan;
  lyons: BetaPlannerComparison;
  reconciliation: BetaDayPlanReconciliation;
};

export function plannerPayloadToBetaComparison(payload: PlannerCsvPayload): BetaPlannerComparisonRequest {
  return {
    planningDate: payload.planningDate,
    routes: payload.runs
      .filter(run => run.includeInImport)
      .map(run => {
        const collections: BetaPlannerStopRequest[] = [];
        const deliveries: BetaPlannerStopRequest[] = [];
        for (const stop of run.stops) {
          const orderKey = String(stop.sourceRow);
          const evidence = { orderKey, reference: stop.reference, pallets: stop.pallets };
          if (stop.collectionSite) collections.push({ name: stop.collectionSite, ...evidence, role: "Collection" });
          if (stop.deliverySite) deliveries.push({ name: stop.deliverySite, ...evidence, role: "Delivery" });
        }
        return {
          reference: run.plannerRun || run.runRef,
          stops: [...collections, ...deliveries],
        };
      }),
  };
}