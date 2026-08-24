import type { DeliveryEta } from "../lib/api";

export type RunProgressStop = { id: string; sequence: number; name: string; plannedArrivalUtc?: string };
export type RunProgressVisit = {
  geofenceName?: string;
  loadStopId?: string;
  enteredAtUtc: string;
  confirmedAtUtc?: string;
  dwellMinutes?: number;
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
  lastDeparture?: { loadStopId?: string; exitedAtUtc?: string; dwellMinutes?: number } | null;
  phase?: string;
  focusStop?: string;
  geofenceOnSite?: boolean;
  trackingFresh?: boolean;
  trackingMoving?: boolean;
  trackingAgeSeconds?: number;
  speedKph?: number;
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
  trackingAgeSeconds?: number;
  speedKph?: number;
  stops: Array<RunProgressStop & { state: string }>;
};

function trackingAgeText(progress?: RunProgressRecord) {
  if (!progress || progress.trackingFresh !== false || progress.trackingAgeSeconds == null) return "";
  return `tracking ${Math.max(1, Math.round(progress.trackingAgeSeconds / 60))}m old`;
}

export function statusFor(progress: RunProgressRecord | undefined, nextEta: DeliveryEta | undefined, etas: DeliveryEta[]) {
  const complete = progress?.runState === "Completed" || (progress?.totalStops || 0) > 0 && progress?.completedStops === progress?.totalStops;
  if (complete) {
    return { status: "complete" as const, label: "AVAILABLE", detail: "Final stop complete · driver available for next work", priority: 10 };
  }
  if (progress?.currentVisit?.isDelayed) {
    return {
      status: "late" as const,
      label: "SITE DELAY",
      detail: `${progress.currentVisit.geofenceName || "On site"} · ${progress.currentVisit.dwellMinutes ?? 0} min dwell`,
      priority: 100,
    };
  }
  const hardRisk = etas.find((eta) => eta.source === "Live" && (eta.risk === "Late" || eta.tachoStatus === "InsufficientDriveTime"));
  if (hardRisk) {
    return {
      status: "late" as const,
      label: hardRisk.tachoStatus === "InsufficientDriveTime" ? "HOURS RISK" : "LATE ETA",
      detail: hardRisk.tachoStatus === "InsufficientDriveTime" ? "Tacho time is below remaining route need" : `${hardRisk.stopName} will miss its window`,
      priority: 95,
    };
  }
  if (nextEta?.source === "Live" && nextEta.risk === "AtRisk") {
    return { status: "risk" as const, label: "AT RISK", detail: `${nextEta.stopName} has limited ETA buffer`, priority: 85 };
  }
  const staleTracking = trackingAgeText(progress);
  if (staleTracking) {
    return {
      status: "risk" as const,
      label: "TRACKING STALE",
      detail: [progress?.focusStop || nextEta?.stopName, staleTracking].filter(Boolean).join(" · "),
      priority: 75,
    };
  }
  if (progress?.currentVisit) {
    return {
      status: "onsite" as const,
      label: progress.currentVisit.confirmedAtUtc ? "ON SITE" : "ARRIVED",
      detail: `${progress.currentVisit.geofenceName || "Matched geofence"} · ${progress.currentVisit.dwellMinutes ?? 0} min`,
      priority: 70,
    };
  }
  if (progress?.geofenceOnSite) {
    return {
      status: "onsite" as const,
      label: "ON SITE",
      detail: progress.focusStop || "Matched geofence",
      priority: 70,
    };
  }
  if (progress?.trackingMoving || (progress?.phase || "").toLowerCase().includes("heading")) {
    return {
      status: "route" as const,
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
      status: "route" as const,
      label: "ON ROUTE",
      detail: String(nextEta?.source) === "Estimated"
        ? `${progress?.nextStop?.name || nextEta?.stopName || "Next stop"} · resilient ETA only`
        : progress?.nextStop?.name || nextEta?.stopName || "Live ETA active",
      priority: 55,
    };
  }
  return { status: "scheduled" as const, label: "SCHEDULED", detail: nextEta?.stopName || "Awaiting tracker/geofence evidence", priority: 30 };
}

function routeRunState(route: RouteProgressRun, fallback?: string) {
  if (route.phase === "Complete") return "Completed";
  if (route.geofenceOnSite || route.phase === "On site") return "OnSiteConfirmed";
  if (route.trackingMoving || route.phase === "Heading to") return "InProgress";
  return fallback || route.phase;
}

function routeFields(route: RouteProgressRun) {
  return {
    phase: route.phase,
    focusStop: route.focusStop,
    geofenceOnSite: route.geofenceOnSite,
    trackingFresh: route.trackingFresh,
    trackingMoving: route.trackingMoving,
    trackingAgeSeconds: route.trackingAgeSeconds,
    speedKph: route.speedKph,
  };
}

export function mergeRouteProgress(progress: RunProgressRecord[], routeRuns: RouteProgressRun[]) {
  const routeByLoad = new Map(routeRuns.map((run) => [run.loadId, run]));
  const merged = progress.map((record) => {
    const route = routeByLoad.get(record.loadId);
    if (!route) return record;
    routeByLoad.delete(record.loadId);
    const nextStop = route.stops.find((stop) => stop.id === route.nextStopId)
      || route.stops.find((stop) => stop.state === "heading" || stop.state === "upcoming")
      || record.nextStop;
    return {
      ...record,
      totalStops: Math.max(record.totalStops || 0, route.totalStops || 0),
      completedStops: Math.max(record.completedStops || 0, route.completedStops || 0),
      progressPercent: Math.max(record.progressPercent || 0, route.truckPositionPercent || 0),
      runState: routeRunState(route, record.runState),
      nextStop,
      ...routeFields(route),
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
