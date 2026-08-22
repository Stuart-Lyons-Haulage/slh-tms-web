import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, request, type DeliveryEta, type DeliveryEtas, type DriverAssignment, type Load } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { parseApiDateTime, todayIsoDate } from "../lib/dateUtils";
import { displayRunReference } from "../lib/runDisplay";
import { useApi } from "../lib/useApi";
import "../operations-wallboard.css";

type RunProgressStop = { id: string; sequence: number; name: string; plannedArrivalUtc?: string };
type RunProgressVisit = {
  geofenceName?: string;
  enteredAtUtc: string;
  confirmedAtUtc?: string;
  dwellMinutes?: number;
  waitLimitMinutes?: number;
  isDelayed: boolean;
  status: string;
  statusReason?: string;
};
type RunProgressRecord = {
  loadId: string;
  loadReference: string;
  loadStatus: string;
  runState: string;
  totalStops: number;
  completedStops: number;
  progressPercent: number;
  nextStop?: RunProgressStop | null;
  currentVisit?: RunProgressVisit | null;
};
type RunProgressResponse = {
  planningDate: string;
  calculatedAtUtc: string;
  geofenceAvailable?: boolean;
  geofenceCount?: number;
  geofenceLinkedRuns?: number;
  latestTrackingUtc?: string;
  warning?: string;
  records: RunProgressRecord[];
};
type RouteProgressRun = {
  loadId: string;
  reference: string;
  totalStops: number;
  completedStops: number;
  phase: string;
  truckPositionPercent: number;
  focusStop?: string;
  nextStopId?: string;
  stops: Array<RunProgressStop & { state: string }>;
};
type RouteProgressResponse = {
  latestTrackingUtc?: string;
  geofenceLinkedRuns?: number;
  runs: RouteProgressRun[];
};

type BoardRow = {
  id: string;
  load?: Load;
  assignment?: DriverAssignment;
  progress?: RunProgressRecord;
  etas: DeliveryEta[];
  nextEta?: DeliveryEta;
  finalEta?: DeliveryEta;
  route: string;
  runLabel: string;
  vehicle: string;
  driver: string;
  scheduledUtc?: string;
  status: "late" | "risk" | "onsite" | "route" | "scheduled" | "complete";
  statusLabel: string;
  statusDetail: string;
  priority: number;
};
type WallboardData = {
  loads: Load[];
  etas: DeliveryEta[];
  progress: RunProgressRecord[];
  assignments: DriverAssignment[];
  warning: string;
  geofenceAvailable: boolean;
  geofenceCount: number;
  geofenceLinkedRuns: number;
  latestTrackingUtc?: string;
  calculatedAtUtc?: string;
};

const UK_TIME_ZONE = "Europe/London";
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TIME_ZONE, weekday: "long", day: "2-digit", month: "long", year: "numeric" });

function ms(value?: string) {
  return parseApiDateTime(value)?.getTime() ?? Number.NaN;
}

function formatTime(value?: string) {
  const parsed = parseApiDateTime(value);
  return parsed ? timeFormatter.format(parsed) : "--:--";
}

function formatAge(value?: string | Date, now = new Date()) {
  const parsed = parseApiDateTime(value);
  if (!parsed) return "no tracker fix";
  const minutes = Math.max(0, Math.round((now.getTime() - parsed.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

function etaSourceText(eta?: DeliveryEta) {
  if (!eta) return "ETA pending";
  if (eta.source === "Live") return `LIVE ETA ${formatTime(eta.etaUtc)}`;
  if (String(eta.source) === "Estimated") return `ESTIMATE ${formatTime(eta.etaUtc)}`;
  return "planned";
}

function firstStop(load?: Load) {
  return [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence)[0];
}

function routeText(load: Load | undefined, etas: DeliveryEta[]) {
  const stops = [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence);
  if (stops.length) return stops.map((stop) => stop.name.replace(/^Collect · |^Deliver · /i, "")).join(" -> ");
  if (etas.length) return etas.map((eta) => eta.stopName.replace(/^Collect · |^Deliver · /i, "")).join(" -> ");
  return "Route not confirmed";
}

function pickNextEta(etas: DeliveryEta[], progress?: RunProgressRecord) {
  const sorted = [...etas].sort((left, right) => left.sequence - right.sequence);
  const nextSequence = progress?.nextStop?.sequence;
  if (nextSequence != null) return sorted.find((eta) => eta.sequence >= nextSequence) || sorted.at(-1);
  const cutoff = Date.now() - 15 * 60 * 1000;
  return sorted.find((eta) => !eta.etaUtc || ms(eta.etaUtc) >= cutoff) || sorted.at(-1);
}

function minutesToWindow(eta?: DeliveryEta) {
  if (!eta?.etaUtc || !eta.deliveryWindowEndUtc) return undefined;
  const value = Math.round((ms(eta.deliveryWindowEndUtc) - ms(eta.etaUtc)) / 60000);
  return Number.isFinite(value) ? value : undefined;
}

function statusFor(progress: RunProgressRecord | undefined, nextEta: DeliveryEta | undefined, etas: DeliveryEta[]) {
  if (progress?.runState === "Completed") {
    return { status: "complete" as const, label: "COMPLETE", detail: "All matched geofence stops completed", priority: 10 };
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
  if (progress?.currentVisit) {
    return {
      status: "onsite" as const,
      label: progress.currentVisit.confirmedAtUtc ? "ON SITE" : "ARRIVED",
      detail: `${progress.currentVisit.geofenceName || "Matched geofence"} · ${progress.currentVisit.dwellMinutes ?? 0} min`,
      priority: 70,
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

function tachoText(eta?: DeliveryEta) {
  if (!eta) return "tacho pending";
  if (eta.tachoStatus === "InsufficientDriveTime") return "insufficient drive time";
  if (eta.tachoStatus === "BreakIncluded") return `${eta.breakMinutesIncluded}m break included`;
  if (eta.tachoStatus === "WithinDriveTime") return "within drive time";
  if (String(eta.tachoStatus) === "EstimateOnly") return "route estimate only";
  if (eta.tachoDriverName) return `matched ${eta.tachoDriverName}`;
  return "tacho unavailable";
}

function mergeRouteProgress(progress: RunProgressRecord[], routeRuns: RouteProgressRun[]) {
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
      totalStops: route.totalStops,
      completedStops: route.completedStops,
      progressPercent: Math.max(record.progressPercent || 0, route.truckPositionPercent || 0),
      runState: route.phase === "Complete" ? "Completed" : record.runState,
      nextStop,
    };
  });
  for (const route of routeByLoad.values()) {
    merged.push({
      loadId: route.loadId,
      loadReference: route.reference,
      loadStatus: route.phase,
      runState: route.phase === "Complete" ? "Completed" : route.phase,
      totalStops: route.totalStops,
      completedStops: route.completedStops,
      progressPercent: route.truckPositionPercent,
      nextStop: route.stops.find((stop) => stop.id === route.nextStopId)
        || route.stops.find((stop) => stop.state === "heading" || stop.state === "upcoming"),
    });
  }
  return merged;
}

export function OperationsWallboard({ tvMode = false }: { tvMode?: boolean }) {
  const token = useAccessToken();
  const today = todayIsoDate();
  const tvAccessKey = tvMode ? new URLSearchParams(window.location.search).get("key")?.trim() : undefined;
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const [liveData, setLiveData] = useState<Pick<WallboardData, "etas" | "progress" | "warning" | "geofenceAvailable" | "geofenceCount" | "geofenceLinkedRuns" | "latestTrackingUtc" | "calculatedAtUtc">>();
  const tableRef = useRef<HTMLDivElement | null>(null);

  const { data, error, loading, refresh } = useApi(useCallback(async () => {
    const access = tvAccessKey ? undefined : await token();
    const tvInit = tvAccessKey ? { headers: { "X-TMS-TV-Key": tvAccessKey } } : undefined;
    const getLoads = (date: string) => tvAccessKey
      ? request<Load[]>(`/api/v1/loads?date=${encodeURIComponent(date)}`, undefined, tvInit)
      : api.loads(date, access);
    const getAssignments = (from: string, to: string) => tvAccessKey
      ? request<DriverAssignment[]>(`/api/v1/driver-assignments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, undefined, tvInit)
      : api.driverAssignments(from, to, access);
    const [currentLoads, assignments] = await Promise.all([
      getLoads(today),
      getAssignments(today, today),
    ]);
    return {
      loads: currentLoads.filter((load) => load.planningDate === today),
      etas: [],
      progress: [],
      assignments,
      warning: "Live tracker, geofence and ETA evidence is loading.",
      geofenceAvailable: true,
      geofenceCount: 0,
      geofenceLinkedRuns: 0,
    } satisfies WallboardData;
  }, [today, token, tvAccessKey]));

  const refreshLiveData = useCallback(async () => {
    const access = tvAccessKey ? undefined : await token();
    const tvInit = tvAccessKey ? { headers: { "X-TMS-TV-Key": tvAccessKey, "X-TV-Display-Key": tvAccessKey } } : undefined;
    const [etaResult, progressResult, routeResult] = await Promise.allSettled([
      request<DeliveryEtas>(`/api/v1/operations/delivery-etas?date=${encodeURIComponent(today)}`, access, tvInit, 90000),
      request<RunProgressResponse>(`/api/v1/run-progress?date=${encodeURIComponent(today)}`, access, tvInit, 90000),
      request<RouteProgressResponse>(`/api/v1/tv-display/route-progress?date=${encodeURIComponent(today)}`, access, tvInit, 90000),
    ]);
    const etas = etaResult.status === "fulfilled" ? etaResult.value : undefined;
    const progress = progressResult.status === "fulfilled" ? progressResult.value : undefined;
    const route = routeResult.status === "fulfilled" ? routeResult.value : undefined;
    setLiveData((previous) => ({
      etas: etas?.records ?? previous?.etas ?? [],
      progress: route
        ? mergeRouteProgress(progress?.records ?? previous?.progress ?? [], route.runs)
        : progress?.records ?? previous?.progress ?? [],
      warning: [
        progress?.warning,
        etas ? undefined : "Live ETA refresh is catching up; retaining the last confirmed ETA snapshot.",
        progress ? undefined : "Geofence refresh is catching up; retaining the last confirmed progression snapshot.",
        route ? undefined : "Live route position is catching up; retaining the last confirmed journey position.",
      ].filter(Boolean).join(" "),
      geofenceAvailable: progress ? progress.geofenceAvailable !== false : previous?.geofenceAvailable ?? true,
      geofenceCount: progress?.geofenceCount ?? previous?.geofenceCount ?? 0,
      geofenceLinkedRuns: Math.max(route?.geofenceLinkedRuns ?? 0, progress?.geofenceLinkedRuns ?? 0, previous?.geofenceLinkedRuns ?? 0),
      latestTrackingUtc: route?.latestTrackingUtc ?? progress?.latestTrackingUtc ?? previous?.latestTrackingUtc,
      calculatedAtUtc: etas?.calculatedAtUtc ?? previous?.calculatedAtUtc,
    }));
  }, [today, token, tvAccessKey]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    const refreshTimer = window.setInterval(() => {
      void Promise.allSettled([refresh(), refreshLiveData()]).then(() => setLastRefresh(new Date()));
    }, 20000);
    void refreshLiveData().then(() => setLastRefresh(new Date()));
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(refreshTimer);
    };
  }, [refresh, refreshLiveData]);

  const boardData = useMemo<WallboardData | undefined>(() => {
    if (!data) return undefined;
    if (!liveData) return data;
    return { ...data, ...liveData, warning: liveData.warning || data.warning };
  }, [data, liveData]);

  const rows = useMemo<BoardRow[]>(() => {
    const loadsById = new Map((boardData?.loads || []).map((load) => [load.id, load]));
    const progressByLoad = new Map((boardData?.progress || []).map((item) => [item.loadId, item]));
    const assignmentByLoad = new Map((boardData?.assignments || []).map((item) => [item.loadId, item]));
    const etaByLoad = new Map<string, DeliveryEta[]>();
    for (const eta of boardData?.etas || []) {
      const list = etaByLoad.get(eta.loadId) || [];
      list.push(eta);
      etaByLoad.set(eta.loadId, list);
    }

    const ids = new Set([...loadsById.keys(), ...etaByLoad.keys(), ...progressByLoad.keys()]);
    return [...ids].map((id) => {
      const load = loadsById.get(id);
      const assignment = assignmentByLoad.get(id);
      const progress = progressByLoad.get(id);
      const etas = [...(etaByLoad.get(id) || [])].sort((a, b) => a.sequence - b.sequence);
      const nextEta = pickNextEta(etas, progress);
      const finalEta = etas.at(-1);
      const status = statusFor(progress, nextEta, etas);
      const scheduledUtc = firstStop(load)?.plannedArrivalUtc || nextEta?.etaUtc || finalEta?.etaUtc;
      const runReference = load?.reference || progress?.loadReference || nextEta?.loadReference || assignment?.loadReference || "RUN TBC";
      const firstPlannedUtc = firstStop(load)?.plannedArrivalUtc || scheduledUtc;
      return {
        id,
        load,
        assignment,
        progress,
        etas,
        nextEta,
        finalEta,
        route: routeText(load, etas),
        runLabel: displayRunReference(runReference, load?.plannerNotes, firstPlannedUtc),
        vehicle: assignment?.vehicle?.registration || nextEta?.vehicleRegistration || "VEHICLE TBC",
        driver: assignment?.driver?.displayName || nextEta?.tachoDriverName || "DRIVER TBC",
        scheduledUtc,
        status: status.status,
        statusLabel: status.label,
        statusDetail: status.detail,
        priority: status.priority,
      };
    }).filter((row) => row.load?.status !== "Cancelled" && row.status !== "complete")
      .sort((left, right) => {
        const leftTime = ms(left.scheduledUtc) || Number.MAX_SAFE_INTEGER;
        const rightTime = ms(right.scheduledUtc) || Number.MAX_SAFE_INTEGER;
        if (left.status === "late" && right.status !== "late") return -1;
        if (right.status === "late" && left.status !== "late") return 1;
        return leftTime - rightTime;
      });
  }, [boardData]);

  const presentRowId = useMemo(() => {
    if (!rows.length) return undefined;
    const now = clock.getTime();
    const tolerance = 30 * 60 * 1000;
    return rows.find((row) => (ms(row.scheduledUtc) || 0) >= now - tolerance)?.id || rows.at(-1)?.id;
  }, [clock, rows]);

  useEffect(() => {
    if (!tvMode || !presentRowId || loading) return;
    window.setTimeout(() => {
      tableRef.current?.querySelector<HTMLElement>(`[data-row-id="${presentRowId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 350);
  }, [lastRefresh, loading, presentRowId, tvMode]);

  const late = rows.filter((row) => row.status === "late").length;
  const risk = rows.filter((row) => row.status === "risk").length;
  const onSite = rows.filter((row) => row.status === "onsite").length;

  async function fullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  return <section className={`ops-wallboard ${tvMode ? "tv" : ""}`}>
    <header className="ops-wallboard-header">
      <div>
        <p>SLH OPERATIONS WALLBOARD</p>
        <h1>Arrivals & Departures</h1>
      </div>
      <div className="ops-wallboard-clock">
        <strong>{timeFormatter.format(clock)}</strong>
        <span>{dateFormatter.format(clock)}</span>
      </div>
      <button type="button" onClick={() => void fullscreen()}>Full screen</button>
    </header>

    <div className="ops-wallboard-summary">
      <article><span>Active board</span><strong>{rows.length}</strong><small>today's live runs</small></article>
      <article className="green"><span>Tracker live</span><strong>{formatAge(boardData?.latestTrackingUtc, clock)}</strong><small>{boardData?.geofenceLinkedRuns ?? 0} geofence-linked runs</small></article>
      <article className="amber"><span>On site</span><strong>{onSite}</strong><small>dwell monitored by geofence</small></article>
      <article className="red"><span>At risk / late</span><strong>{late + risk}</strong><small>{late} late · {risk} at risk</small></article>
      <article><span>Updated</span><strong>{formatAge(lastRefresh, clock)}</strong><small>{boardData?.geofenceCount ?? 0} approved geofences</small></article>
    </div>

    {(error || boardData?.warning || boardData?.geofenceAvailable === false) && <div className="ops-wallboard-alert">
      {error || boardData?.warning || "Geofence progression is unavailable; ETA risk is using tracker/tacho data where available."}
    </div>}

    <div className="ops-board-table" ref={tableRef} role="table" aria-label="Operations arrivals and departures">
      <div className="ops-board-head" role="row">
        <span>Time</span><span>Run</span><span>Vehicle</span><span>Driver</span><span>Progress</span><span>ETA</span><span>Status</span>
      </div>
      {loading && !data && <div className="ops-board-empty">Loading tracker, geofence and tacho progress...</div>}
      {!loading && rows.length === 0 && <div className="ops-board-empty">No active runs are available for the wallboard.</div>}
      {rows.map((row) => {
        const buffer = minutesToWindow(row.nextEta);
        const completedStops = row.progress?.completedStops ?? 0;
        const totalStops = row.progress?.totalStops || row.etas.length || row.load?.stops?.length || 0;
        const completedPercent = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0;
        const progressPercent = Math.min(100, Math.max(completedPercent, Math.round(row.progress?.progressPercent ?? 0)));
        const progressLabel = row.progress?.currentVisit
          ? `${row.progress.currentVisit.geofenceName || "On site"} · ${row.progress.currentVisit.dwellMinutes ?? 0}m`
          : `${completedStops} of ${totalStops || "?"} stops`;
        return <article className={`ops-board-row ${row.status} ${row.id === presentRowId ? "present" : ""}`} role="row" key={row.id} data-row-id={row.id}>
          <span className="time-cell"><strong>{formatTime(row.scheduledUtc)}</strong><small>{etaSourceText(row.nextEta)}</small></span>
          <span className="run-cell"><strong>{row.runLabel}</strong><small>{row.progress?.nextStop?.name || row.nextEta?.stopName || "Next stop TBC"}</small></span>
          <span><strong>{row.vehicle}</strong><small>{row.assignment?.trailerNumber ? `Trailer ${row.assignment.trailerNumber}` : "vehicle"}</small></span>
          <span><strong>{row.driver}</strong><small>{tachoText(row.nextEta)}</small></span>
          <span className="progress-cell"><strong>{progressLabel}</strong><div className="ops-progress-bar"><i style={{ width: `${progressPercent}%` }} /></div><small>{progressPercent}% through route</small></span>
          <span className="time-cell eta"><strong>{formatTime(row.nextEta?.etaUtc)}</strong><small>{formatAge(row.nextEta?.trackingUpdatedAtUtc || boardData?.latestTrackingUtc, clock)}</small></span>
          <span className="status-cell"><strong>{row.statusLabel}</strong><small>{buffer == null ? row.statusDetail : `${buffer >= 0 ? "+" : ""}${buffer}m · ${row.statusDetail}`}</small></span>
        </article>;
      })}
    </div>

    <footer className="ops-wallboard-footer">
      <span>RoadTech + geofences + Azure Maps truck traffic + TachoMaster</span>
      <span>Only LIVE ETA can create customer-window risk</span>
      <span>Refresh every 20 seconds</span>
      <span>Last refresh {formatAge(lastRefresh, clock)}</span>
    </footer>
  </section>;
}
