import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, request, type DeliveryEta, type DeliveryEtas, type DriverAssignment, type Load } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { parseApiDateTime, todayIsoDate } from "../lib/dateUtils";
import { displayRunReference } from "../lib/runDisplay";
import { useApi } from "../lib/useApi";
import { completedJobCount, mergeRouteProgress, statusFor, type RouteProgressRun, type RunProgressRecord } from "./operationsWallboardProgress";
import "../operations-wallboard.css";

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
  route: string;
  runLabel: string;
  vehicle: string;
  driver: string;
  scheduledUtc?: string;
  displayTimeUtc?: string;
  displayTimeLabel: string;
  focusStop: string;
  status: "late" | "risk" | "onsite" | "route" | "scheduled" | "complete";
  statusLabel: string;
  statusDetail: string;
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

function parsed(value?: string) { return parseApiDateTime(value); }
function ms(value?: string) { return parsed(value)?.getTime() ?? Number.NaN; }
function formatTime(value?: string) { const valueDate = parsed(value); return valueDate ? timeFormatter.format(valueDate) : "--:--"; }
function formatAge(value?: string | Date, now = new Date()) {
  const valueDate = value instanceof Date ? value : parsed(value);
  if (!valueDate) return "no tracker fix";
  const minutes = Math.max(0, Math.round((now.getTime() - valueDate.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}
function firstStop(load?: Load) { return [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence)[0]; }
function routeText(load: Load | undefined, etas: DeliveryEta[]) {
  const stops = [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence);
  if (stops.length) return stops.map(stop => stop.name.replace(/^Collect · |^Deliver · /i, "")).join(" -> ");
  if (etas.length) return etas.map(eta => eta.stopName.replace(/^Collect · |^Deliver · /i, "")).join(" -> ");
  return "Route not confirmed";
}
function pickNextEta(etas: DeliveryEta[], progress?: RunProgressRecord) {
  const sorted = [...etas].sort((a, b) => a.sequence - b.sequence);
  if (!sorted.length) return undefined;
  const nextSequence = progress?.nextStop?.sequence;
  if (nextSequence != null) {
    return sorted.find(eta => eta.sequence === nextSequence && eta.source === "Live")
      || sorted.find(eta => eta.sequence > nextSequence && eta.source === "Live")
      || sorted.find(eta => eta.sequence === nextSequence)
      || sorted.find(eta => eta.sequence > nextSequence)
      || sorted.at(-1);
  }
  return sorted.find(eta => eta.source === "Live") || sorted[0];
}
function minutesToWindow(eta?: DeliveryEta) {
  if (!eta?.etaUtc || !eta.deliveryWindowEndUtc) return undefined;
  const minutes = Math.round((ms(eta.deliveryWindowEndUtc) - ms(eta.etaUtc)) / 60000);
  return Number.isFinite(minutes) ? minutes : undefined;
}
function tachoText(eta?: DeliveryEta) {
  if (!eta) return "tacho pending";
  if (eta.tachoStatus === "InsufficientDriveTime") return "insufficient drive time";
  if (eta.tachoStatus === "BreakIncluded") return `${eta.breakMinutesIncluded}m break included`;
  if (eta.tachoStatus === "WithinDriveTime") return "within drive time";
  if (eta.tachoDriverName) return `matched ${eta.tachoDriverName}`;
  return "tacho unavailable";
}
function formatDwell(seconds?: number, minutes?: number) {
  const totalMinutes = seconds != null ? Math.max(0, Math.floor(seconds / 60)) : Math.max(0, minutes ?? 0);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}
function dwellLabel(progress?: RunProgressRecord) {
  if (progress?.currentVisit) return `Time on site: ${formatDwell(progress.currentVisit.liveDwellSeconds, progress.currentVisit.liveDwellMinutes ?? progress.currentVisit.dwellMinutes)}`;
  const departed = progress?.lastDeparture || [...(progress?.stopDwell || [])].reverse().find(stop => stop.state === "Departed");
  if (departed) return `Dwell time: ${formatDwell(departed.finalDwellSeconds, departed.finalDwellMinutes ?? ("dwellMinutes" in departed ? departed.dwellMinutes : undefined))}`;
  return progress?.linkageException ? "Geofence link needs review" : undefined;
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
    const tvInit = tvAccessKey ? { headers: { "X-TMS-TV-Key": tvAccessKey, "X-TV-Display-Key": tvAccessKey } } : undefined;
    const getLoads = (date: string) => tvAccessKey
      ? request<Load[]>(`/api/v1/loads?date=${encodeURIComponent(date)}`, undefined, tvInit)
      : api.loads(date, access);
    const getAssignments = (from: string, to: string) => tvAccessKey
      ? request<DriverAssignment[]>(`/api/v1/driver-assignments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, undefined, tvInit)
      : api.driverAssignments(from, to, access);
    const [loads, assignments] = await Promise.all([getLoads(today), getAssignments(today, today)]);
    return {
      loads: loads.filter(load => load.planningDate === today && load.status !== "Cancelled"),
      assignments,
      etas: [], progress: [], warning: "Live tracker, geofence and ETA evidence is loading.",
      geofenceAvailable: true, geofenceCount: 0, geofenceLinkedRuns: 0,
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
    setLiveData(previous => ({
      etas: etas?.records ?? previous?.etas ?? [],
      progress: route ? mergeRouteProgress(progress?.records ?? previous?.progress ?? [], route.runs) : progress?.records ?? previous?.progress ?? [],
      warning: [
        progress?.warning,
        etas ? undefined : "Live ETA refresh is catching up; planned journeys remain visible.",
        progress ? undefined : "Geofence refresh is catching up; planned journeys remain visible.",
        route ? undefined : "Live route position is catching up; planned journeys remain visible.",
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
    return () => { window.clearInterval(clockTimer); window.clearInterval(refreshTimer); };
  }, [refresh, refreshLiveData]);

  const boardData = useMemo<WallboardData | undefined>(() => data ? liveData ? { ...data, ...liveData, warning: liveData.warning || data.warning } : data : undefined, [data, liveData]);

  const rows = useMemo<BoardRow[]>(() => {
    const loadsById = new Map((boardData?.loads || []).map(load => [load.id, load]));
    const progressByLoad = new Map((boardData?.progress || []).map(item => [item.loadId, item]));
    const assignmentByLoad = new Map((boardData?.assignments || []).map(item => [item.loadId, item]));
    const etaByLoad = new Map<string, DeliveryEta[]>();
    for (const eta of boardData?.etas || []) {
      const list = etaByLoad.get(eta.loadId) || [];
      list.push(eta); etaByLoad.set(eta.loadId, list);
    }
    const ids = new Set([...loadsById.keys(), ...progressByLoad.keys(), ...etaByLoad.keys()]);
    return [...ids].map(id => {
      const load = loadsById.get(id);
      const progress = progressByLoad.get(id);
      const assignment = assignmentByLoad.get(id);
      const etas = [...(etaByLoad.get(id) || [])].sort((a, b) => a.sequence - b.sequence);
      const nextEta = pickNextEta(etas, progress);
      const status = statusFor(progress, nextEta, etas);
      const complete = status.status === "complete";
      const arrivalUtc = progress?.currentVisit?.enteredAtUtc;
      const plannedNextUtc = progress?.nextStop?.plannedArrivalUtc;
      const liveEtaUtc = nextEta?.source === "Live" ? nextEta.etaUtc : undefined;
      const fallbackEtaUtc = nextEta?.etaUtc || plannedNextUtc;
      const scheduledUtc = firstStop(load)?.plannedArrivalUtc || fallbackEtaUtc;
      const runReference = load?.reference || progress?.loadReference || nextEta?.loadReference || assignment?.loadReference || "RUN TBC";
      return {
        id, load, assignment, progress, etas, nextEta,
        route: routeText(load, etas),
        runLabel: displayRunReference(runReference, load?.plannerNotes, firstStop(load)?.plannedArrivalUtc || scheduledUtc),
        vehicle: assignment?.vehicle?.registration || nextEta?.vehicleRegistration || "VEHICLE TBC",
        driver: assignment?.driver?.displayName || nextEta?.tachoDriverName || "DRIVER TBC",
        scheduledUtc,
        displayTimeUtc: complete ? undefined : arrivalUtc || liveEtaUtc || fallbackEtaUtc,
        displayTimeLabel: complete ? "AVAILABLE" : arrivalUtc ? "ARRIVED" : liveEtaUtc ? "LIVE ETA" : fallbackEtaUtc ? "PLANNED BACKUP" : "ETA PENDING",
        focusStop: complete ? "Available for next job" : progress?.currentVisit?.geofenceName || progress?.nextStop?.name || nextEta?.stopName || "Next stop TBC",
        status: status.status, statusLabel: status.label, statusDetail: status.detail,
      };
    }).filter(row => row.load?.status !== "Cancelled")
      .sort((a, b) => {
        if (a.status === "complete" && b.status !== "complete") return 1;
        if (b.status === "complete" && a.status !== "complete") return -1;
        if (a.status === "late" && b.status !== "late") return -1;
        if (b.status === "late" && a.status !== "late") return 1;
        return (ms(a.scheduledUtc) || Number.MAX_SAFE_INTEGER) - (ms(b.scheduledUtc) || Number.MAX_SAFE_INTEGER);
      });
  }, [boardData]);

  const late = rows.filter(row => row.status === "late").length;
  const risk = rows.filter(row => row.status === "risk").length;
  const onSite = rows.filter(row => row.status === "onsite").length;
  const available = rows.filter(row => row.status === "complete").length;
  const completeJobs = completedJobCount(boardData?.progress || []);
  const presentRowId = useMemo(() => rows.find(row => row.status !== "complete" && (ms(row.scheduledUtc) || 0) >= clock.getTime() - 30 * 60 * 1000)?.id || rows.find(row => row.status !== "complete")?.id, [clock, rows]);

  useEffect(() => {
    if (!tvMode || !presentRowId || loading) return;
    window.setTimeout(() => tableRef.current?.querySelector<HTMLElement>(`[data-row-id="${presentRowId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 350);
  }, [lastRefresh, loading, presentRowId, tvMode]);

  async function fullscreen() { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }

  return <section className={`ops-wallboard ${tvMode ? "tv" : ""}`}>
    <header className="ops-wallboard-header">
      <div><p>SLH OPERATIONS WALLBOARD</p><h1>Arrivals & Departures</h1></div>
      <div className="ops-wallboard-clock"><strong>{timeFormatter.format(clock)}</strong><span>{dateFormatter.format(clock)}</span></div>
      <button type="button" onClick={() => void fullscreen()}>Full screen</button>
    </header>
    <div className="ops-wallboard-summary">
      <article><span>Runs on board</span><strong>{rows.length}</strong><small>all planned journeys retained</small></article>
      <article className="green"><span>Tracker live</span><strong>{formatAge(boardData?.latestTrackingUtc, clock)}</strong><small>{boardData?.geofenceLinkedRuns ?? 0} geofence-linked runs</small></article>
      <article className="amber"><span>On site</span><strong>{onSite}</strong><small>arrival time replaces ETA</small></article>
      <article className="green"><span>Complete</span><strong>{completeJobs}</strong><small>departed geofenced stops</small></article>
      <article className="red"><span>At risk / late</span><strong>{late + risk}</strong><small>{late} late · {risk} at risk</small></article>
      <article className="green"><span>Available</span><strong>{available}</strong><small>final stop completed</small></article>
    </div>
    {(error || boardData?.warning || boardData?.geofenceAvailable === false) && <div className="ops-wallboard-alert">{error || boardData?.warning || "Geofence progression is unavailable; planned journeys remain displayed."}</div>}
    <div className="ops-board-table" ref={tableRef} role="table" aria-label="Operations arrivals and departures">
      <div className="ops-board-head" role="row"><span>Time</span><span>Run</span><span>Vehicle</span><span>Driver</span><span>Journey</span><span>ETA / Arrival</span><span>Status</span></div>
      {loading && !data && <div className="ops-board-empty">Loading planned journeys and live progression...</div>}
      {!loading && rows.length === 0 && <div className="ops-board-empty">No runs are planned for today.</div>}
      {rows.map(row => {
        const buffer = minutesToWindow(row.nextEta);
        const completedStops = row.progress?.completedStops ?? 0;
        const totalStops = row.progress?.totalStops || row.load?.stops?.length || row.etas.length || 0;
        const percent = totalStops > 0 ? Math.min(100, Math.max(Math.round(completedStops / totalStops * 100), Math.round(row.progress?.progressPercent ?? 0))) : 0;
        const progressLabel = row.progress?.currentVisit
          ? `${row.progress.currentVisit.geofenceName || "On site"} · ${dwellLabel(row.progress)}`
          : row.status === "complete"
            ? dwellLabel(row.progress) || "Journey complete"
            : row.progress?.focusStop
              ? `${row.progress.phase || "Next"} · ${row.progress.focusStop}`
              : `${completedStops} of ${totalStops || "?"} stops`;
        return <article className={`ops-board-row ${row.status} ${row.id === presentRowId ? "present" : ""}`} role="row" key={row.id} data-row-id={row.id}>
          <span className="time-cell"><strong>{formatTime(row.scheduledUtc)}</strong><small>{row.status === "complete" ? "completed" : "planned start"}</small></span>
          <span className="run-cell"><strong>{row.runLabel}</strong><small>{row.focusStop}</small></span>
          <span><strong>{row.vehicle}</strong><small>{row.assignment?.trailerNumber ? `Trailer ${row.assignment.trailerNumber}` : "vehicle"}</small></span>
          <span><strong>{row.driver}</strong><small>{tachoText(row.nextEta)}</small></span>
          <span className="progress-cell"><strong>{progressLabel}</strong><div className="ops-progress-bar"><i style={{ width: `${percent}%` }} /></div><small>{row.progress?.linkageException?.message || row.route}</small></span>
          <span className="time-cell eta"><strong>{row.displayTimeLabel === "AVAILABLE" ? "AVAILABLE" : formatTime(row.displayTimeUtc)}</strong><small>{row.displayTimeLabel}{row.displayTimeLabel === "LIVE ETA" ? ` · ${formatAge(row.nextEta?.trackingUpdatedAtUtc || boardData?.latestTrackingUtc, clock)}` : ""}</small></span>
          <span className="status-cell"><strong>{row.statusLabel}</strong><small>{buffer == null || row.status === "onsite" || row.status === "complete" ? row.statusDetail : `${buffer >= 0 ? "+" : ""}${buffer}m · ${row.statusDetail}`}</small></span>
        </article>;
      })}
    </div>
    <footer className="ops-wallboard-footer"><span>RoadTech + geofences + Azure Maps + TachoMaster</span><span>Live ETA first · planned time is backup only</span><span>Departed geofence = completed job</span><span>Refresh every 20 seconds · {formatAge(lastRefresh, clock)}</span></footer>
  </section>;
}
