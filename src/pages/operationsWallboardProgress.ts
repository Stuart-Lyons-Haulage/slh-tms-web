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

export type GeofenceProgressStop = { sequence?: number; state?: string };
export type GeofenceProgressMarker = { state: "done" | "onsite" | "pending"; left: number };

/** Build the wallboard progress line from confirmed geofence exits. */
export function geofenceProgress(stops: GeofenceProgressStop[] | undefined, totalStops: number, completedStops: number): GeofenceProgressMarker[] {
  const ordered = [...(stops || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const count = Math.max(ordered.length, totalStops || 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const state = String(ordered[index]?.state || "").toLowerCase();
    const exited = state === "departed" || state === "completed" || state === "exited" || (!state && index < completedStops);
    const onsite = !exited && state === "onsite";
    return { state: exited ? "done" : onsite ? "onsite" : "pending", left: ((index + 1) / count) * 100 };
  });
}

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

const RISK_BUFFER_MINUTES = 15;

function trackingAgeText(progress?: RunProgressRecord) {
  if (!progress || progress.trackingFresh !== false || progress.trackingAgeSeconds == null) return "";
  return `tracking ${Math.max(1, Math.round(progress.trackingAgeSeconds / 60))}m old`;
}

function timeMs(value?: string) {
  if (!value) return Number.NaN;
  const valueMs = Date.parse(value);
  return Number.isFinite(valueMs) ? valueMs : Number.NaN;
}

function nextStopDeadline(progress: RunProgressRecord | undefined, eta: DeliveryEta | undefined) {
  return progress?.nextStop?.plannedArrivalUtc || eta?.deliveryWindowEndUtc;
}

function nextStopKind(stopName: string) {
  if (/^deliver\b/i.test(stopName)) return { label: "DELIVERY", plan: "delivery plan" };
  if (/^collect\b/i.test(stopName)) return { label: "COLLECTION", plan: "collection plan" };
  return { label: "NEXT STOP", plan: "planned time" };
}

function nextStopAdvisory(progress: RunProgressRecord | undefined, eta: DeliveryEta | undefined, nowMs: number): WallboardStatusResult | undefined {
  if (progress?.currentVisit || progress?.geofenceOnSite) return undefined;
  const deadlineMs = timeMs(nextStopDeadline(progress, eta));
  if (!Number.isFinite(deadlineMs)) return undefined;

  const etaMs = timeMs(eta?.etaUtc);
  const stopName = progress?.nextStop?.name || eta?.stopName || "Next stop";
  const kind = nextStopKind(stopName);
  if (Number.isFinite(etaMs)) {
    const bufferMinutes = Math.floor((deadlineMs - etaMs) / 60000);
    if (bufferMinutes < 0) {
      return {
        status: "risk",
        label: `${kind.label} BEHIND`,
        detail: `${stopName} is ${Math.abs(bufferMinutes)}m behind ${kind.plan} · final customer delivery ETA assessed separately`,
        priority: 64,
      };
    }
    if (bufferMinutes <= RISK_BUFFER_MINUTES) {
      return {
        status: "risk",
        label: `${kind.label} TIGHT`,
        detail: `${stopName} has ${bufferMinutes}m buffer to ${kind.plan}`,
        priority: 63,
      };
    }
    return undefined;
  }

  const overdueMinutes = Math.floor((nowMs - deadlineMs) / 60000);
  if (overdueMinutes >= 0) {
    return {
      status: "risk",
      label: "ETA UNCONFIRMED",
      detail: `${stopName} planned time passed ${overdueMinutes}m ago · no live arrival/ETA evidence`,
      priority: 62,
    };
  }
  return undefined;
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

function finalDeliveryAssessment(etas: DeliveryEta[]): FinalDeliveryAssessment {
  const finalEta = finalEtaFor(etas);
  const etaMs = timeMs(finalEta?.etaUtc);
  const deadlineMs = timeMs(finalEta?.deliveryWindowEndUtc);
  if (!Number.isFinite(etaMs) || !Number.isFinite(deadlineMs)) return { onTime: false };

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
  if (bufferMinutes <= RISK_BUFFER_MINUTES) {
    return {
      onTime: false,
      bufferMinutes,
      result: {
        status: "risk",
        label: "FINAL ETA AT RISK",
        detail: `${stopName} has ${bufferMinutes}m buffer to delivery latest time`,
        priority: 88,
      },
    };
  }
  return { onTime: true, bufferMinutes };
}

export function statusFor(progress: RunProgressRecord | undefined, nextEta: DeliveryEta | undefined, etas: DeliveryEta[], nowMs = Date.now()): WallboardStatusResult {
  const complete = progress?.runState === "Completed"
    || (progress?.totalStops || 0) > 0 && progress?.completedStops === progress?.totalStops
    || Boolean(progress && isFinalStopArrival(progress));
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

  const finalAssessment = finalDeliveryAssessment(etas);
  if (finalAssessment.result) return finalAssessment.result;

  // The next stop is an execution milestone, not necessarily the final customer promise.
  // Once a cumulative final ETA and final delivery latest time are both known and healthy,
  // do not colour the whole run merely because an intermediate milestone is behind plan.
  if (!finalAssessment.onTime) {
    const nextTiming = nextStopAdvisory(progress, nextEta, nowMs);
    if (nextTiming) return nextTiming;
  }

  const hardCustomerRisk = etas.find((eta) => eta.source === "Live" && eta.risk === "Late" && eta.deliveryWindowEndUtc);
  if (hardCustomerRisk) {
    return {
      status: "late",
      label: "LATE DELIVERY ETA",
      detail: `${hardCustomerRisk.stopName} will miss its customer window`,
      priority: 94,
    };
  }

  if (!finalAssessment.onTime && nextEta?.source === "Live" && nextEta.risk === "AtRisk") {
    return { status: "risk", label: "AT RISK", detail: `${nextEta.stopName} has limited ETA buffer`, priority: 85 };
  }
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

function stopEvidenceScore(stops?: RunProgressRecord["stopDwell"]) {
  return (stops || []).reduce((score, stop) => score + (stop.state === "Departed" ? 3 : stop.state === "OnSite" ? 2 : 1), 0);
}

function routeFields(route: RouteProgressRun, record?: RunProgressRecord) {
  const recordGeofenceAhead = Boolean(record?.currentVisit || record?.geofenceOnSite)
    || (record?.completedStops || 0) > (route.completedStops || 0);
  const routeGeofenceAhead = Boolean(route.currentVisit || route.geofenceOnSite)
    || (route.completedStops || 0) > (record?.completedStops || 0);
  const preferRecordGeofence = recordGeofenceAhead && !routeGeofenceAhead;
  const preferRouteTracking = route.trackingFresh === true || record?.trackingFresh !== true;
  const routeStopScore = stopEvidenceScore(route.stopDwell);
  const recordStopScore = stopEvidenceScore(record?.stopDwell);

  return {
    phase: preferRecordGeofence ? record?.phase : route.phase || record?.phase,
    focusStop: preferRecordGeofence ? record?.focusStop : route.focusStop || record?.focusStop,
    geofenceOnSite: Boolean(record?.geofenceOnSite || record?.currentVisit || route.geofenceOnSite || route.currentVisit),
    trackingFresh: route.trackingFresh ?? record?.trackingFresh,
    trackingMoving: Boolean(record?.trackingMoving || route.trackingMoving),
    ignitionOn: preferRouteTracking ? route.ignitionOn ?? record?.ignitionOn : record?.ignitionOn ?? route.ignitionOn,
    driverCardPresent: preferRouteTracking ? route.driverCardPresent ?? record?.driverCardPresent : record?.driverCardPresent ?? route.driverCardPresent,
    trackingAgeSeconds: preferRouteTracking ? route.trackingAgeSeconds ?? record?.trackingAgeSeconds : record?.trackingAgeSeconds ?? route.trackingAgeSeconds,
    speedKph: preferRouteTracking ? route.speedKph ?? record?.speedKph : record?.speedKph ?? route.speedKph,
    tacho: route.tacho ?? record?.tacho,
    currentVisit: route.currentVisit ?? record?.currentVisit,
    stopDwell: routeStopScore > recordStopScore ? route.stopDwell : record?.stopDwell ?? route.stopDwell,
    linkageException: preferRecordGeofence ? record?.linkageException : route.linkageException ?? record?.linkageException,
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
    const nextStop = (route.completedStops || 0) > (record.completedStops || 0)
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
  if (record.totalStops <= 0) return false;
  const finalStop = record.stopDwell?.find(stop => stop.sequence === record.totalStops);
  // The route-progress feed can lag behind the durable geofence feed: in that
  // window the final stop is already OnSite/Departed while completedStops is
  // still one short. Treat that as the same final-arrival evidence as a live
  // currentVisit so the board cannot show the driver as moving past the finish.
  if (finalStop?.state === "OnSite" || finalStop?.state === "Departed") return true;
  if (!record.currentVisit) return false;
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
