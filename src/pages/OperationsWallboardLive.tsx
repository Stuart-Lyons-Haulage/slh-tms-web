import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, request, type DeliveryEta, type DeliveryEtas, type DriverAssignment, type Load } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { parseApiDateTime, todayIsoDate } from "../lib/dateUtils";
import { displayRunReference } from "../lib/runDisplay";
import { useApi } from "../lib/useApi";
import { completedJobCount, finalEtaFor, geofenceProgress, isScheduleVisible, isWallboardActionRequired, mergeRouteProgress, statusFor, type RouteProgressRun, type RunProgressRecord, type RunTachoEvidence } from "./operationsWallboardProgress";
import { enrichRouteFinalDestination, mergeWallboardTiming, type RunTimingRecord, type RunTimingResponse } from "./operationsWallboardTiming";
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
  tachoWarning?: string;
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
  displayTimeUtc?: string;
  displayTimeLabel: string;
  focusStop: string;
  status: "late" | "risk" | "onsite" | "route" | "scheduled" | "complete";
  statusLabel: string;
  statusDetail: string;
  tacho?: RunTachoEvidence | null;
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
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}
function firstStop(load?: Load) { return [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence)[0]; }
function finalDestinationStop(load?: Load) {
  const stops = [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence);
  return [...stops].reverse().find(stop => /^Deliver\b/i.test(stop.name || "") || Boolean(stop.orderId)) || stops.at(-1);
}
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
function isFinalCurrentVisit(progress?: RunProgressRecord) {
  if (!progress?.currentVisit || progress.totalStops <= 0) return false;
  const currentStopSequence = progress.stopDwell?.find(stop => stop.stopId === progress.currentVisit?.loadStopId)?.sequence
    ?? (progress.nextStop && progress.nextStop.id === progress.currentVisit.loadStopId ? progress.nextStop.sequence : undefined);
  if (currentStopSequence != null) return currentStopSequence === progress.totalStops;
  return progress.completedStops === progress.totalStops - 1;
}
function minutesToWindow(eta?: DeliveryEta) {
  if (!eta?.etaUtc || !eta.deliveryWindowEndUtc) return undefined;
  const minutes = Math.round((ms(eta.deliveryWindowEndUtc) - ms(eta.etaUtc)) / 60000);
  return Number.isFinite(minutes) ? minutes : undefined;
}
function formatTachoTime(value?: string) {
  const valueDate = parsed(value);
  return valueDate ? timeFormatter.format(valueDate) : undefined;
}
function tachoText(tacho?: RunTachoEvidence | null, eta?: DeliveryEta) {
  if (tacho?.status === "Matched") return `signed on ${formatTachoTime(tacho.signOnUtc) || ""}`.trim();
  if (tacho?.status === "CardConfirmed") return `card confirmed ${formatTachoTime(tacho.signOnUtc) || ""}`.trim();
  if (tacho?.status === "Mismatch") return "tacho mismatch";
  if (tacho?.status === "NoTachoDuty") return "sign-on evidence unavailable";
  if (tacho?.status === "NoPlannedDriver") return "no planned driver";
  if (tacho?.status === "NoPlannedVehicle") return "no planned vehicle";
  if (tacho?.status === "Unavailable") return "TachoMaster unavailable";
  if (!eta) return "TachoMaster evidence missing";
  if (eta.tachoStatus === "InsufficientDriveTime") return "insufficient drive time";
  if (eta.tachoStatus === "BreakIncluded") return `${eta.breakMinutesIncluded}m break included`;
  if (eta.tachoStatus === "CardConfirmedWithinDriveTime") return "card confirmed";
  if (eta.tachoStatus === "CardConfirmedHoursUnavailable") return "card confirmed · hours missing";
  if (eta.tachoStatus === "WithinDriveTime") return "within drive time";
  if (eta.tachoDriverName) return `matched ${eta.tachoDriverName}`;
  return "tacho unavailable";
}
function mergeEtaSnapshots(previous: DeliveryEta[], incoming: DeliveryEta[]) {
  if (!incoming.length) return previous;
  const merged = new Map(previous.map(eta => [`${eta.loadId}|${eta.sequence}`, eta]));
  for (const eta of incoming) merged.set(`${eta.loadId}|${eta.sequence}`, eta);
  return [...merged.values()];
}

function stopEvidenceScore(stops?: RunProgressRecord["stopDwell"]) {
  return (stops || []).reduce((score, stop) => score + (stop.state === "Departed" ? 3 : stop.state === "OnSite" ? 2 : 1), 0);
}

function mergeProgressSnapshots(previous: RunProgressRecord[], incoming: RunProgressRecord[]) {
  if (!incoming.length) return previous;
  const merged = new Map(previous.map(record => [record.loadId, record]));
  for (const next of incoming) {
    const current = merged.get(next.loadId);
    if (!current) { merged.set(next.loadId, next); continue; }
    const preserveCurrentProgress = current.completedStops > next.completedStops;
    const currentStopScore = stopEvidenceScore(current.stopDwell);
    const nextStopScore = stopEvidenceScore(next.stopDwell);
    merged.set(next.loadId, {
      ...next,
      completedStops: Math.max(current.completedStops, next.completedStops),
      progressPercent: Math.max(current.progressPercent, next.progressPercent),
      runState: current.runState === "Completed" ? current.runState : next.runState,
      currentVisit: next.currentVisit ?? current.currentVisit,
      lastDeparture: next.lastDeparture ?? current.lastDeparture,
      stopDwell: nextStopScore >= currentStopScore ? next.stopDwell : current.stopDwell,
      linkageException: next.linkageException ?? current.linkageException,
      nextStop: preserveCurrentProgress ? current.nextStop ?? next.nextStop : next.nextStop ?? current.nextStop,
      phase: preserveCurrentProgress ? current.phase ?? next.phase : next.phase ?? current.phase,
      focusStop: preserveCurrentProgress ? current.focusStop ?? next.focusStop : next.focusStop ?? current.focusStop,
      geofenceOnSite: Boolean(current.geofenceOnSite || current.currentVisit || next.geofenceOnSite || next.currentVisit),
      trackingFresh: next.trackingFresh ?? current.trackingFresh,
      trackingMoving: next.trackingMoving ?? current.trackingMoving,
      ignitionOn: next.ignitionOn ?? current.ignitionOn,
      driverCardPresent: next.driverCardPresent ?? current.driverCardPresent,
      trackingAgeSeconds: next.trackingAgeSeconds ?? current.trackingAgeSeconds,
      speedKph: next.speedKph ?? current.speedKph,
      tacho: next.tacho ?? current.tacho,
    });
  }
  return [...merged.values()];
}

export function OperationsWallboard({ tvMode = false, tvAccessKey: suppliedTvAccessKey }: { tvMode?: boolean; tvAccessKey?: string }) {
  const token = useAccessToken();
  const today = todayIsoDate();
  const tvAccessKey = tvMode
    ? suppliedTvAccessKey?.trim() || new URLSearchParams(window.location.search).get("key")?.trim()
    : undefined;
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const [liveData, setLiveData] = useState<Pick<WallboardData, "etas" | "progress" | "warning" | "geofenceAvailable" | "geofenceCount" | "geofenceLinkedRuns" | "latestTrackingUtc" | "calculatedAtUtc">>();
  const tableRef = useRef<HTMLDivElement | null>(null);
  const lastTimingRef = useRef(new Map<string, RunTimingRecord>());
  const acceptedFinalEtasRef = useRef(new Map<string, string>());

  const { data, error, loading, refresh } = useApi(useCallback(async () => {
    const access = tvAccessKey ? undefined : await token();
    const tvInit = tvAccessKey ? { headers: { "X-TMS-TV-Key": tvAccessKey, "X-TV-Display-Key": tvAccessKey } } : undefined;
    const getLoads = (date: string) =>
      request<Load[]>(`/api/v1/tv-display/planned-runs?date=${encodeURIComponent(date)}`, access, tvInit);
    const getAssignments = (from: string, to: string) => tvAccessKey
      ? request<DriverAssignment[]>(`/api/v1/driver-assignments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, undefined, tvInit)
      : api.driverAssignments(from, to, access);
    const [loadsResult, assignmentsResult] = await Promise.allSettled([getLoads(today), getAssignments(today, today)]);
    if (loadsResult.status === "rejected") throw loadsResult.reason;
    return {
      loads: loadsResult.value.filter(load => load.status !== "Cancelled"),
      assignments: assignmentsResult.status === "fulfilled" ? assignmentsResult.value : [],
      etas: [], progress: [],
      warning: assignmentsResult.status === "rejected"
        ? "Planned runs are visible; driver and vehicle assignment enrichment is temporarily unavailable."
        : "Live tracker, geofence and ETA evidence is loading.",
      geofenceAvailable: true, geofenceCount: 0, geofenceLinkedRuns: 0,
    } satisfies WallboardData;
  }, [today, token, tvAccessKey]));

  const refreshLiveData = useCallback(async () => {
    const access = tvAccessKey ? undefined : await token();
    const tvInit = tvAccessKey ? { headers: { "X-TMS-TV-Key": tvAccessKey, "X-TV-Display-Key": tvAccessKey } } : undefined;
    const [etaResult, progressResult, routeResult, timingResult] = await Promise.allSettled([
      request<DeliveryEtas>(`/api/v1/operations/delivery-etas?date=${encodeURIComponent(today)}`, access, tvInit, 90000),
      request<RunProgressResponse>(`/api/v1/run-progress?date=${encodeURIComponent(today)}`, access, tvInit, 90000),
      request<RouteProgressResponse>(`/api/v1/tv-display/route-progress?date=${encodeURIComponent(today)}`, access, tvInit, 90000),
      request<RunTimingResponse>(`/api/v1/run-timing?date=${encodeURIComponent(today)}`, access, tvInit, 90000),
    ]);
    const etas = etaResult.status === "fulfilled" ? etaResult.value : undefined;
    const progress = progressResult.status === "fulfilled" ? progressResult.value : undefined;
    const route = routeResult.status === "fulfilled" ? routeResult.value : undefined;
    const timing = timingResult.status === "fulfilled" ? timingResult.value : undefined;
    setLiveData(previous => {
      const timedEtas = mergeWallboardTiming(
        etas?.records ?? [],
        timing?.records ?? [],
        lastTimingRef.current,
        acceptedFinalEtasRef.current,
      );
      const stableEtas = mergeEtaSnapshots(previous?.etas ?? [], timedEtas);
      const stableProgress = mergeProgressSnapshots(previous?.progress ?? [], progress?.records ?? []);
      const routeRuns = route ? enrichRouteFinalDestination(route.runs) : undefined;
      return {
        etas: stableEtas,
        progress: routeRuns ? mergeRouteProgress(stableProgress, routeRuns) : stableProgress,
        warning: [
          progress?.warning,
          route?.tachoWarning,
          etas ? undefined : "Live ETA refresh is catching up; previous final ETAs remain visible.",
          progress ? undefined : "Geofence refresh is catching up; previous confirmed progression remains visible.",
          route ? undefined : "Live route position is catching up; planned journeys remain visible.",
          timing ? undefined : "Run timing enrichment is catching up; the last accepted final customer ETA remains visible.",
        ].filter(Boolean).join(" "),
        geofenceAvailable: progress ? progress.geofenceAvailable !== false : previous?.geofenceAvailable ?? true,
        geofenceCount: progress?.geofenceCount ?? previous?.geofenceCount ?? 0,
        geofenceLinkedRuns: Math.max(route?.geofenceLinkedRuns ?? 0, progress?.geofenceLinkedRuns ?? 0, previous?.geofenceLinkedRuns ?? 0),
        latestTrackingUtc: route?.latestTrackingUtc ?? progress?.latestTrackingUtc ?? previous?.latestTrackingUtc,
        calculatedAtUtc: etas?.calculatedAtUtc ?? previous?.calculatedAtUtc,
      };
    });
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
    const ids = new Set(loadsById.keys());
    return [...ids].map(id => {
      const load = loadsById.get(id);
      const progress = progressByLoad.get(id);
      const assignment = assignmentByLoad.get(id);
      const etas = [...(etaByLoad.get(id) || [])].sort((a, b) => a.sequence - b.sequence);
      const nextEta = pickNextEta(etas, progress);
      const finalEta = finalEtaFor(etas);
      const status = statusFor(progress, nextEta, etas);
      const complete = status.status === "complete";
      const finalArrivalUtc = isFinalCurrentVisit(progress) ? progress?.currentVisit?.enteredAtUtc : undefined;
      const liveEtaUtc = finalEta?.source === "Live" ? finalEta.etaUtc : undefined;
      const estimatedEtaUtc = finalEta?.source === "Estimated" ? finalEta.etaUtc : undefined;
      const scheduledUtc = firstStop(load)?.plannedArrivalUtc || progress?.nextStop?.plannedArrivalUtc;
      const runReference = load?.reference || progress?.loadReference || nextEta?.loadReference || finalEta?.loadReference || assignment?.loadReference || "RUN TBC";
      return {
        id, load, assignment, progress, etas, nextEta, finalEta,
        route: routeText(load, etas),
        runLabel: displayRunReference(runReference, load?.plannerNotes, firstStop(load)?.plannedArrivalUtc || scheduledUtc),
        vehicle: assignment?.vehicle?.registration || nextEta?.vehicleRegistration || finalEta?.vehicleRegistration || "VEHICLE TBC",
        driver: assignment?.driver?.displayName || nextEta?.tachoDriverName || finalEta?.tachoDriverName || "DRIVER TBC",
        scheduledUtc,
        displayTimeUtc: complete ? undefined : finalArrivalUtc || liveEtaUtc || estimatedEtaUtc,
        displayTimeLabel: complete ? "AVAILABLE" : finalArrivalUtc ? "ARRIVED" : liveEtaUtc ? "LIVE FINAL ETA" : estimatedEtaUtc ? "ESTIMATED FINAL ETA" : "FINAL ETA PENDING",
        focusStop: complete ? "Available for next job" : progress?.currentVisit?.geofenceName || progress?.nextStop?.name || nextEta?.stopName || "Next stop TBC",
        status: status.status, statusLabel: status.label, statusDetail: status.detail,
        tacho: progress?.tacho,
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

  const visibleRows = useMemo(() => rows.filter(row => isScheduleVisible(row.scheduledUtc, row.status, clock.getTime())), [clock, rows]);
  const attentionRows = useMemo(() => visibleRows.filter(row => isWallboardActionRequired(row.status)
    || (Number(row.progress?.currentVisit?.liveDwellMinutes ?? row.progress?.currentVisit?.dwellMinutes ?? 0) >= 60)), [visibleRows]);
  const late = visibleRows.filter(row => row.status === "late").length;
  const risk = visibleRows.filter(row => row.status === "risk").length;
  const onSite = visibleRows.filter(row => row.status === "onsite").length;
  const available = visibleRows.filter(row => row.status === "complete").length;
  const completeJobs = completedJobCount(boardData?.progress || []);
  const presentRowId = useMemo(() => visibleRows.find(row => row.status !== "complete" && (ms(row.scheduledUtc) || 0) >= clock.getTime() - 30 * 60 * 1000)?.id || visibleRows.find(row => row.status !== "complete")?.id, [clock, visibleRows]);

  useEffect(() => {
    if (!tvMode || !presentRowId || loading) return;
    window.setTimeout(() => tableRef.current?.querySelector<HTMLElement>(`[data-row-id="${presentRowId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 350);
  }, [lastRefresh, loading, presentRowId, tvMode]);

  async function fullscreen() { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }

  return <section className={`ops-wallboard ${tvMode ? "tv" : ""}`}>
    <header className="ops-wallboard-header">
      <div className="ops-wallboard-brand"><img className="ops-wallboard-logo" src="/lyons-logo.svg" alt="Lyons" /><div><p>SLH OPERATIONS WALLBOARD</p><h1>Arrivals & Departures</h1></div></div>
      <div className="ops-wallboard-clock"><strong>{timeFormatter.format(clock)}</strong><span>{dateFormatter.format(clock)}</span></div>
      <button type="button" onClick={() => void fullscreen()}>Full screen</button>
    </header>
    <div className="ops-wallboard-summary">
      <article><span>Runs on board</span><strong>{visibleRows.length}</strong><small>runs due in the next three hours</small></article>
      <article className="green"><span>Tracker live</span><strong>{formatAge(boardData?.latestTrackingUtc, clock)}</strong><small>{boardData?.geofenceLinkedRuns ?? 0} geofence-linked runs</small></article>
      <article className="amber"><span>On site</span><strong>{onSite}</strong><small>current site evidence retained</small></article>
      <article className="green"><span>Complete</span><strong>{completeJobs}</strong><small>departed geofenced stops</small></article>
      <article className="red"><span>At risk / late</span><strong>{late + risk}</strong><small>{late} proved late · {risk} needs attention</small></article>
      <article className="green"><span>Available</span><strong>{available}</strong><small>final stop completed</small></article>
    </div>
    {(error || boardData?.warning || boardData?.geofenceAvailable === false) && <div className="ops-wallboard-alert">{error || boardData?.warning || "Geofence progression is unavailable; planned journeys remain displayed."}</div>}
    <div className="ops-board-layout">
      <div className="ops-board-table" ref={tableRef} role="table" aria-label="Operations arrivals and departures">
        <div className="ops-board-head" role="row"><span>Time</span><span>Run</span><span>Vehicle</span><span>Driver</span><span>Progress</span><span>Final delivery / ETA</span><span>Status</span></div>
        {loading && !data && <div className="ops-board-empty">Loading planned journeys and live progression...</div>}
        {!loading && visibleRows.length === 0 && <div className="ops-board-empty">No runs are due in the next three hours.</div>}
        {visibleRows.map(row => {
          const buffer = minutesToWindow(row.finalEta);
          const completedStops = row.progress?.completedStops ?? 0;
          const totalStops = row.progress?.totalStops || row.load?.stops?.length || row.etas.length || 0;
          const markers = geofenceProgress(row.progress?.stopDwell, totalStops, completedStops);
          const filled = markers.filter(marker => marker.state === "done").length;
          const percent = markers.length > 0 ? (filled / markers.length) * 100 : 0;
          const finalStopName = (row.finalEta?.stopName || finalDestinationStop(row.load)?.name || "Final delivery").replace(/^Collect · |^Deliver · /i, "");
          return <article className={`ops-board-row ${row.status} ${row.id === presentRowId ? "present" : ""}`} role="row" key={row.id} data-row-id={row.id}>
            <span className="time-cell"><strong>{formatTime(row.scheduledUtc)}</strong><small>{row.status === "complete" ? "completed" : "planned start"}</small></span>
            <span className="run-cell"><strong>{row.runLabel}</strong><small>{row.focusStop}</small></span>
            <span><strong>{row.vehicle}</strong><small>{row.assignment?.trailerNumber ? `Trailer ${row.assignment.trailerNumber}` : "vehicle"}</small></span>
            <span><strong>{row.driver}</strong><small title={row.tacho?.explanation}>{tachoText(row.tacho, row.finalEta || row.nextEta)}</small></span>
            <span className="progress-cell"><div className="ops-progress-bar" aria-label={`${filled} of ${markers.length} geofences exited`}><i style={{ width: `${percent}%` }} />{markers.map((marker, index) => <b className={`ops-progress-marker ${marker.state}`} key={`${row.id}-marker-${index}`} style={{ left: `${marker.left}%` }} />)}</div><small>{filled} of {markers.length} geofences exited</small></span>
            <span className="time-cell eta"><strong>{row.displayTimeLabel === "AVAILABLE" ? "AVAILABLE" : formatTime(row.displayTimeUtc)}</strong><small>{finalStopName} · {row.displayTimeLabel}{row.displayTimeLabel === "LIVE FINAL ETA" ? ` · ${formatAge(row.finalEta?.trackingUpdatedAtUtc || boardData?.latestTrackingUtc, clock)}` : ""}</small></span>
            <span className="status-cell"><strong>{row.statusLabel}</strong><small>{buffer == null || row.status === "onsite" || row.status === "complete" ? row.statusDetail : `${buffer >= 0 ? "+" : ""}${buffer}m · ${row.statusDetail}`}</small></span>
          </article>;
        })}
      </div>
      <aside className="ops-attention-panel" aria-label="Attention needs action">
        <h2>ATTENTION · NEEDS ACTION</h2>
        <div className="ops-attention-list">
          {attentionRows.length === 0 && <div className="ops-attention-clear"><b>✓ No immediate exceptions</b><small>Late ETA, route risk and 1h+ geofence dwell are clear.</small></div>}
          {attentionRows.slice(0, 4).map(row => {
            const dwellMinutes = Number(row.progress?.currentVisit?.liveDwellMinutes ?? row.progress?.currentVisit?.dwellMinutes ?? 0);
            const dwellRisk = dwellMinutes >= 60 && !isWallboardActionRequired(row.status);
            const finalStopName = (row.finalEta?.stopName || finalDestinationStop(row.load)?.name || "Final delivery").replace(/^Collect · |^Deliver · /i, "");
            const action = dwellRisk ? "Check site hold" : row.status === "late" ? "Escalate delivery" : "Review route";
            const value = dwellRisk ? `${dwellMinutes}m` : row.finalEta?.etaUtc ? formatTime(row.finalEta.etaUtc) : "RISK";
            return <article className={`ops-attention-card ${row.status}`} key={`attention-${row.id}`}>
              <span className="ops-attention-icon">!</span>
              <div><b>{row.runLabel}</b><strong>{finalStopName}</strong><small>{row.statusLabel}</small><em>Action: {action}</em></div>
              <span className="ops-attention-value"><b>{value}</b><small>{dwellRisk ? "dwell" : "ETA"}</small></span>
            </article>;
          })}
        </div>
      </aside>
    </div>
    <footer className="ops-wallboard-footer"><span>RoadTech + geofences + Azure Maps + TachoMaster</span><span>Final ETA targets final customer destination · next stop drives risk</span><span>Departed geofence = completed job</span><span>Refresh every 20 seconds · {formatAge(lastRefresh, clock)}</span></footer>
  </section>;
}
