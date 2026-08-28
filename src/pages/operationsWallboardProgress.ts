import type { DeliveryEta } from "../lib/api";

export type RunProgressStop = { id: string; sequence: number; name: string; plannedArrivalUtc?: string };
export type RunProgressVisit = {
  geofenceName?: string;
  loadStopId?: string;
  enteredAtUtc: string;
  siteArrivalUtc?: string;
  siteDepartureUtc?: string;
  confirmedAtUtc?: string;
  dwellMinutes?: number;
  liveDwellMinutes?: number;
  liveDwellSeconds?: number;
  finalDwellMinutes?: number;
  finalDwellSeconds?: number;
  waitLimitMinutes?: number;
  isDelayed: boolean;
  status: string;
  statusReason?: string;
};
export type RunProgressRecord = {
  loadId: string;
  loadReference: string;
  loadStatus: string;
  runState: string;
  totalStops: number;
  completedStops: number;
  progressPercent: number;
  nextStop?: RunProgressStop | null;
  currentVisit?: RunProgressVisit | null;
  lastDeparture?: { loadStopId?: string; exitedAtUtc?: string; dwellMinutes?: number; finalDwellMinutes?: number; finalDwellSeconds?: number } | null;
  stopDwell?: Array<{ stopId: string; sequence: number; stopName: string; state: "EnRoute" | "OnSite" | "Departed"; siteArrivalUtc?: string; siteDepartureUtc?: string; liveDwellMinutes?: number; liveDwellSeconds?: number; finalDwellMinutes?: number; finalDwellSeconds?: number }>;
  linkageException?: { state: string; geofenceName: string; message: string } | null;
  phase?: string;
  focusStop?: string;
  geofenceOnSite?: boolean;
  trackingFresh?: boolean;
  trackingMoving?: boolean;
  ignitionOn?: boolean;
  driverCardPresent?: boolean;
  trackingAgeSeconds?: number;
  speedKph?: number;
  tacho?: RunTachoEvidence | null;
};
export type RunTachoEvidence = {
  status: "Matched" | "CardConfirmed" | "Mismatch" | "NoTachoDuty" | "NoPlannedDriver" | "NoPlannedVehicle" | "Unavailable" | string;
  driverName?: string;
  vehicleCode?: string;
  signOnUtc?: string;
  dutyEndUtc?: string;
  driveAvailableTodayMinutes?: number;
  driveAvailableWeekMinutes?: number;
  workAvailableWeekMinutes?: number;
  cardConfirmed?: boolean;
  legalHoursAvailable?: boolean;
  evidenceSource?: string;
  explanation?: string;
};
export type RouteProgressRun = {
  loadId: string;
  reference: string;
  totalStops: number;
  completedStops: number;
  phase: string;
  truckPositionPercent: number;
  focusStop?: string;
  nextStopId?: string;
  geofenceOnSite?: boolean;
  trackingFresh?: boolean;
  trackingMoving?: boolean;
  ignitionOn?: boolean;
  driverCardPresent?: boolean;
  trackingAgeSeconds?: number;
  speedKph?: number;
  tacho?: RunTachoEvidence | null;
  currentVisit?: RunProgressVisit | null;
  stopDwell?: RunProgressRecord["stopDwell"];
  linkageException?: RunProgressRecord["linkageException"];
  stops: Array<RunProgressStop & { state: string }>;
};

type WallboardStatusResult = {
  status: "late" | "risk" | "onsite" | "route" | "scheduled" | "complete";
  label: string;
  detail: string;
  priority: number;
};

type FinalDeliveryAssessment = {
  result?: WallboardStatusResult;
  onTime: boolean;
  bufferMinutes?: number;
};

function trackingAgeText(progress?: RunProgressRecord) {
  if (!progress || progress.trackingFresh !== false || progress.trackingAgeSeconds == null) return "";
  return `tracking ${Math.max(1, Math.round(progress.trackingAgeSeconds / 60))}m old`;
}

function timeMs(value?: string) {
  if (!value) return Number.NaN;
  const valueMs = Date.parse(value);
  return Number.isFinite(valueMs) ? valueMs : Number.NaN;
}

function isFinalDestinationEta(eta: DeliveryEta) {
  const marked = Boolean((eta as DeliveryEta & { isFinalDestination?: boolean }).isFinalDestination);
  return marked
    || /^deliver\b/i.test(String(eta.stopName || ""))
    || Boolean(eta.orderReference || eta.customerCode || eta.deliveryWindowEndUtc);
}

export function finalEtaFor(etas: DeliveryEta[]) {
  const sorted = [...etas].sort((a, b) => a.sequence - b.sequence);
  return [...sorted].reverse().find(isFinalDestinationEta) || sorted.at(-1);
}

function finalDeliveryAssessment(etas: DeliveryEta[], finalDeadlineUtc?: string): FinalDeliveryAssessment {
  const finalEta = finalEtaFor(etas);
  const etaMs = timeMs(finalEta?.etaUtc);
  if (!Number.isFinite(etaMs)) return { onTime: false };

  // Customer risk is assessed only against the final customer promise. Prefer the
  // order's latest delivery-window time; when the order has no explicit window,
  // the final planned customer-stop time is the operational deadline.
  const deadlineMs = timeMs(finalEta?.deliveryWindowEndUtc || finalDeadlineUtc);
  if (!Number.isFinite(deadlineMs)) {
    // A valid cumulative final ETA must not turn the whole run amber merely because
    // an intermediate collection/delivery milestone is behind its planning time.
    return { onTime: true };
  }

  const bufferMinutes = Math.floor((deadlineMs - etaMs) / 60000);
  const stopName = finalEta?.stopName || "Final delivery";
  if (bufferMinutes < 0) {
    const estimated = finalEta?.source === "Estimated";
    return {
      onTime: false,
      bufferMinutes,
      result: {
        status: estimated ? "risk" : "late",
        label: estimated ? "FINAL ETA AT RISK" : "LATE FINAL ETA",
        detail: `${stopName} final ETA is ${Math.abs(bufferMinutes)}m after delivery latest time`,
        priority: estimated ? 89 : 96,
      },
    };
  }

  // The requested operating rule is binary at the final customer deadline: an ETA
  // before/on the last accepted time remains on route; an ETA beyond it is risk/late.
  return { onTime: true, bufferMinutes };
}

export function statusFor(progress: RunProgressRecord | undefined, nextEta: DeliveryEta | undefined, etas: DeliveryEta[], _nowMs?: number, finalDeadlineUtc?: string): WallboardStatusResult {
  const complete = progress?.runState === "Completed" || (progress?.totalStops || 0) > 0 && progress?.completedStops === progress?.totalStops;
  if (complete) {
    return { status: "complete", label: "AVAILABLE", detail: "Final stop complete · driver available for next work", priority: 10 };
  }
  if (progress?.currentVisit?.isDelayed) {
    return {
      status: "late",
      label: "SITE DELAY",
      detail: `${progress.currentVisit.geofenceName || "On site"} · ${progress.currentVisit.dwellMinutes ?? 0} min dwell`,
      priority: 100,
    };
  }
  if (progress?.currentVisit) {
    return {
      status: "onsite",
      label: progress.currentVisit.confirmedAtUtc ? "ON SITE" : "ARRIVED",
      detail: `${progress.currentVisit.geofenceName || "Matched geofence"} · ${progress.currentVisit.dwellMinutes ?? 0} min`,
      priority: 70,
    };
  }
  if (progress?.geofenceOnSite) {
    return {
      status: "onsite",
      label: "ON SITE",
      detail: progress.focusStop || "Matched geofence",
      priority: 70,
    };
  }

  // A future/planned ETA must never make a parked vehicle look active. When Falcon
  // positively reports ignition off and no driver card, and no geofence progression
  // has proved departure, the run has not started and remains scheduled.
  if (progress?.trackingFresh && progress.phase === "Next job" && progress.ignitionOn === false && progress.driverCardPresent === false) {
    return {
      status: "scheduled",
      label: "SCHEDULED",
      detail: `${progress.nextStop?.name || nextEta?.stopName || "Next job"} · ignition off · no driver card`,
      priority: 35,
    };
  }

  const hoursRisk = etas.find((eta) => eta.tachoStatus === "InsufficientDriveTime");
  if (hoursRisk) {
    return {
      status: "late",
      label: "HOURS RISK",
      detail: "Tacho time is below remaining route need",
      priority: 95,
    };
  }

  const finalAssessment = finalDeliveryAssessment(etas, finalDeadlineUtc);
  if (finalAssessment.result) return finalAssessment.result;

  // Intermediate collection/delivery timing variance is informational only.
  // Whole-run ETA risk is governed exclusively by the cumulative final-customer ETA above.
  const staleTracking = trackingAgeText(progress);
  if (staleTracking) {
    return {
      status: "risk",
      label: "TRACKING STALE",
      detail: [progress?.focusStop || nextEta?.stopName, staleTracking].filter(Boolean).join(" · "),
      priority: 75,
    };
  }
  if (progress?.trackingMoving) {
    return {
      status: "route",
      label: "ON ROUTE",
      detail: [
        progress?.focusStop || progress?.nextStop?.name || nextEta?.stopName || "Live route active",
        progress?.speedKph != null ? `${Math.round(progress.speedKph)} km/h` : undefined,
      ].filter(Boolean).join(" · "),
      priority: 58,
    };
  }
  if ((progress?.completedStops || 0) > 0 || nextEta?.source === "Live" || String(nextEta?.source) === "Estimated") {
    return {
      status: "route",
      label: "ON ROUTE",
      detail: String(nextEta?.source) === "Estimated"
        ? `${progress?.nextStop?.name || nextEta?.stopName || "Next stop"} · resilient ETA only`
        : progress?.nextStop?.name || nextEta?.stopName || "Live ETA active",
      priority: 55,
    };
  }
  return { status: "scheduled", label: "SCHEDULED", detail: progress?.nextStop?.name || nextEta?.stopName || "Awaiting tracker/geofence evidence", priority: 30 };
}

function routeRunState(route: RouteProgressRun, fallback?: string) {
  if (route.phase === "Complete") return "Completed";
  if (route.geofenceOnSite || route.phase === "On site") return "OnSiteConfirmed";
  if (route.trackingMoving || route.completedStops > 0) return "InProgress";
  return fallback || route.phase;
}

type StopDwellEvidence = NonNullable<RunProgressRecord["stopDwell"]>[number];

function stopStateWeight(state: StopDwellEvidence["state"]) {
  return state === "Departed" ? 3 : state === "OnSite" ? 2 : 1;
}

export function stopEvidenceScore(stops?: RunProgressRecord["stopDwell"]) {
  return (stops || []).reduce((score, stop) => score + stopStateWeight(stop.state), 0);
}

export function mergeStopDwellEvidence(
  left?: RunProgressRecord["stopDwell"],
  right?: RunProgressRecord["stopDwell"],
) {
  const merged = new Map<string, StopDwellEvidence>();
  for (const stop of [...(left || []), ...(right || [])]) {
    const existing = merged.get(stop.stopId);
    if (!existing) {
      merged.set(stop.stopId, stop);
      continue;
    }
    const preferred = stopStateWeight(stop.state) >= stopStateWeight(existing.state) ? stop : existing;
    const other = preferred === stop ? existing : stop;
    merged.set(stop.stopId, {
      ...other,
      ...preferred,
      siteArrivalUtc: preferred.siteArrivalUtc ?? other.siteArrivalUtc,
      siteDepartureUtc: preferred.siteDepartureUtc ?? other.siteDepartureUtc,
      liveDwellMinutes: preferred.liveDwellMinutes ?? other.liveDwellMinutes,
      liveDwellSeconds: preferred.liveDwellSeconds ?? other.liveDwellSeconds,
      finalDwellMinutes: preferred.finalDwellMinutes ?? other.finalDwellMinutes,
      finalDwellSeconds: preferred.finalDwellSeconds ?? other.finalDwellSeconds,
    });
  }
  return [...merged.values()].sort((a, b) => a.sequence - b.sequence);
}

export function progressEvidenceStrength(record?: Pick<RunProgressRecord, "completedStops" | "stopDwell" | "currentVisit" | "geofenceOnSite">) {
  if (!record) return 0;
  return Math.max(0, record.completedStops || 0) * 1000
    + stopEvidenceScore(record.stopDwell) * 10
    + (record.currentVisit ? 5 : 0)
    + (record.geofenceOnSite ? 2 : 0);
}

function routeEvidenceStrength(route: RouteProgressRun) {
  return Math.max(0, route.completedStops || 0) * 1000
    + stopEvidenceScore(route.stopDwell) * 10
    + (route.currentVisit ? 5 : 0)
    + (route.geofenceOnSite ? 2 : 0);
}

function routeFields(route: RouteProgressRun, record?: RunProgressRecord) {
  const preferRecordGeofence = progressEvidenceStrength(record) >= routeEvidenceStrength(route);
  const preferRouteTracking = route.trackingFresh === true || record?.trackingFresh !== true;
  const evidenceCurrentVisit = preferRecordGeofence ? record?.currentVisit : route.currentVisit;

  return {
    phase: preferRecordGeofence ? record?.phase ?? route.phase : route.phase || record?.phase,
    focusStop: preferRecordGeofence ? record?.focusStop ?? route.focusStop : route.focusStop || record?.focusStop,
    geofenceOnSite: Boolean(evidenceCurrentVisit || (preferRecordGeofence ? record?.geofenceOnSite : route.geofenceOnSite)),
    trackingFresh: route.trackingFresh ?? record?.trackingFresh,
    trackingMoving: Boolean(record?.trackingMoving || route.trackingMoving),
    ignitionOn: preferRouteTracking ? route.ignitionOn ?? record?.ignitionOn : record?.ignitionOn ?? route.ignitionOn,
    driverCardPresent: preferRouteTracking ? route.driverCardPresent ?? record?.driverCardPresent : record?.driverCardPresent ?? route.driverCardPresent,
    trackingAgeSeconds: preferRouteTracking ? route.trackingAgeSeconds ?? record?.trackingAgeSeconds : record?.trackingAgeSeconds ?? route.trackingAgeSeconds,
    speedKph: preferRouteTracking ? route.speedKph ?? record?.speedKph : record?.speedKph ?? route.speedKph,
    tacho: route.tacho ?? record?.tacho,
    currentVisit: evidenceCurrentVisit,
    stopDwell: mergeStopDwellEvidence(record?.stopDwell, route.stopDwell),
    linkageException: preferRecordGeofence ? record?.linkageException ?? route.linkageException : route.linkageException ?? record?.linkageException,
  };
}

export function mergeRouteProgress(progress: RunProgressRecord[], routeRuns: RouteProgressRun[]) {
  const routeByLoad = new Map(routeRuns.map((run) => [run.loadId, run]));
  const merged = progress.map((record) => {
    const route = routeByLoad.get(record.loadId);
    if (!route) return record;
    routeByLoad.delete(record.loadId);
    const routeNextStop = route.stops.find((stop) => stop.id === route.nextStopId)
      || route.stops.find((stop) => stop.state === "heading" || stop.state === "upcoming");
    const preferRouteEvidence = routeEvidenceStrength(route) > progressEvidenceStrength(record);
    const nextStop = preferRouteEvidence
      ? routeNextStop || record.nextStop
      : record.nextStop || routeNextStop;
    const totalStops = Math.max(record.totalStops || 0, route.totalStops || 0);
    const completedStops = Math.max(record.completedStops || 0, route.completedStops || 0);
    return {
      ...record,
      totalStops,
      completedStops,
      progressPercent: Math.max(record.progressPercent || 0, route.truckPositionPercent || 0),
      runState: record.runState === "Completed" || totalStops > 0 && completedStops === totalStops
        ? "Completed"
        : routeRunState(route, record.runState),
      nextStop,
      ...routeFields(route, record),
    };
  });
  for (const route of routeByLoad.values()) {
    merged.push({
      loadId: route.loadId,
      loadReference: route.reference,
      loadStatus: route.phase,
      runState: routeRunState(route),
      totalStops: route.totalStops,
      completedStops: route.completedStops,
      progressPercent: route.truckPositionPercent,
      nextStop: route.stops.find((stop) => stop.id === route.nextStopId)
        || route.stops.find((stop) => stop.state === "heading" || stop.state === "upcoming"),
      ...routeFields(route),
    });
  }
  return merged;
}

function isFinalStopArrival(record: RunProgressRecord) {
  if (!record.currentVisit || record.totalStops <= 0) return false;
  const nextStop = record.nextStop;
  const currentStopSequence = record.stopDwell?.find(stop => stop.stopId === record.currentVisit?.loadStopId)?.sequence
    ?? (nextStop && nextStop.id === record.currentVisit.loadStopId ? nextStop.sequence : undefined);
  if (currentStopSequence != null) return currentStopSequence === record.totalStops;
  return record.completedStops === record.totalStops - 1;
}

export function completedJobCount(progress: RunProgressRecord[]) {
  return progress.reduce((total, record) => {
    const completed = Math.max(0, record.completedStops || 0);
    const finalArrival = isFinalStopArrival(record) ? 1 : 0;
    return total + Math.min(Math.max(0, record.totalStops || completed + finalArrival), completed + finalArrival);
  }, 0);
}
