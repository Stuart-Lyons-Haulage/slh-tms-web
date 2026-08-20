import { useCallback, useEffect, useMemo, useState } from "react";
import { api, request, type DeliveryEta, type DriverAssignment, type Load } from "../lib/api";
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

const UK_TIME_ZONE = "Europe/London";
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TIME_ZONE, weekday: "long", day: "2-digit", month: "long", year: "numeric" });

function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

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
  const hardRisk = etas.find((eta) => eta.risk === "Late" || eta.tachoStatus === "InsufficientDriveTime");
  if (hardRisk) {
    return {
      status: "late" as const,
      label: hardRisk.tachoStatus === "InsufficientDriveTime" ? "HOURS RISK" : "LATE ETA",
      detail: hardRisk.tachoStatus === "InsufficientDriveTime" ? "Tacho time is below remaining route need" : `${hardRisk.stopName} will miss its window`,
      priority: 95,
    };
  }
  if (nextEta?.risk === "AtRisk") {
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
  if ((progress?.completedStops || 0) > 0 || nextEta?.source === "Live") {
    return { status: "route" as const, label: "ON ROUTE", detail: progress?.nextStop?.name || nextEta?.stopName || "Live ETA active", priority: 55 };
  }
  return { status: "scheduled" as const, label: "SCHEDULED", detail: nextEta?.stopName || "Awaiting tracker/geofence evidence", priority: 30 };
}

function tachoText(eta?: DeliveryEta) {
  if (!eta) return "tacho pending";
  if (eta.tachoStatus === "InsufficientDriveTime") return "insufficient drive time";
  if (eta.tachoStatus === "BreakIncluded") return `${eta.breakMinutesIncluded}m break included`;
  if (eta.tachoStatus === "WithinDriveTime") return "within drive time";
  if (eta.tachoDriverName) return `matched ${eta.tachoDriverName}`;
  return "tacho unavailable";
}

export function OperationsWallboard({ tvMode = false }: { tvMode?: boolean }) {
  const token = useAccessToken();
  const today = todayIsoDate();
  const previous = shiftIsoDate(today, -1);
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState(() => new Date());

  const { data, error, loading, refresh } = useApi(useCallback(async () => {
    const access = await token();
    const [previousLoads, currentLoads, previousEtas, currentEtas, previousProgress, currentProgress, assignments] = await Promise.all([
      api.loads(previous, access).catch(() => []),
      api.loads(today, access),
      api.deliveryEtas(previous, access).catch(() => undefined),
      api.deliveryEtas(today, access),
      request<RunProgressResponse>(`/api/v1/run-progress?date=${encodeURIComponent(previous)}`, access).catch(() => undefined),
      request<RunProgressResponse>(`/api/v1/run-progress?date=${encodeURIComponent(today)}`, access),
      api.driverAssignments(previous, today, access),
    ]);
    return {
      loads: [...previousLoads, ...currentLoads],
      etas: [...(previousEtas?.records || []), ...(currentEtas.records || [])],
      progress: [...(previousProgress?.records || []), ...(currentProgress.records || [])],
      assignments,
      warning: [previousProgress?.warning, currentProgress.warning].filter(Boolean).join(" "),
      geofenceAvailable: previousProgress?.geofenceAvailable !== false && currentProgress.geofenceAvailable !== false,
      geofenceCount: Math.max(previousProgress?.geofenceCount || 0, currentProgress.geofenceCount || 0),
      geofenceLinkedRuns: (previousProgress?.geofenceLinkedRuns || 0) + (currentProgress.geofenceLinkedRuns || 0),
      latestTrackingUtc: currentProgress.latestTrackingUtc || previousProgress?.latestTrackingUtc,
      calculatedAtUtc: currentEtas.calculatedAtUtc,
    };
  }, [previous, today, token]));

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    const refreshTimer = window.setInterval(() => {
      void refresh().then(() => setLastRefresh(new Date()));
    }, 20000);
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(refreshTimer);
    };
  }, [refresh]);

  const rows = useMemo<BoardRow[]>(() => {
    const loadsById = new Map((data?.loads || []).map((load) => [load.id, load]));
    const progressByLoad = new Map((data?.progress || []).map((item) => [item.loadId, item]));
    const assignmentByLoad = new Map((data?.assignments || []).map((item) => [item.loadId, item]));
    const etaByLoad = new Map<string, DeliveryEta[]>();
    for (const eta of data?.etas || []) {
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
    }).filter((row) => row.load?.status !== "Cancelled")
      .sort((left, right) => {
        const priority = right.priority - left.priority;
        if (priority) return priority;
        return (ms(left.scheduledUtc) || Number.MAX_SAFE_INTEGER) - (ms(right.scheduledUtc) || Number.MAX_SAFE_INTEGER);
      });
  }, [data]);

  const late = rows.filter((row) => row.status === "late").length;
  const risk = rows.filter((row) => row.status === "risk").length;
  const live = rows.filter((row) => row.nextEta?.source === "Live" || row.progress?.currentVisit || (row.progress?.completedStops || 0) > 0).length;
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
      <article><span>Active board</span><strong>{rows.length}</strong><small>runs and carried-over jobs</small></article>
      <article className="green"><span>Tracker/geofence live</span><strong>{live}</strong><small>{data?.geofenceLinkedRuns ?? 0} linked runs</small></article>
      <article className="amber"><span>On site</span><strong>{onSite}</strong><small>dwell monitored by geofence</small></article>
      <article className="red"><span>At risk / late</span><strong>{late + risk}</strong><small>{late} late · {risk} at risk</small></article>
      <article><span>Latest tracker</span><strong>{formatAge(data?.latestTrackingUtc, clock)}</strong><small>{data?.geofenceCount ?? 0} approved geofences</small></article>
    </div>

    {(error || data?.warning || data?.geofenceAvailable === false) && <div className="ops-wallboard-alert">
      {error || data?.warning || "Geofence progression is unavailable; ETA risk is using tracker/tacho data where available."}
    </div>}

    <div className="ops-board-table" role="table" aria-label="Operations arrivals and departures">
      <div className="ops-board-head" role="row">
        <span>STD</span><span>ETA</span><span>Run</span><span>Vehicle</span><span>Driver</span><span>Next / destination</span><span>Progress</span><span>Tracker</span><span>Tacho</span><span>Status</span>
      </div>
      {loading && !data && <div className="ops-board-empty">Loading tracker, geofence and tacho progress...</div>}
      {!loading && rows.length === 0 && <div className="ops-board-empty">No active runs are available for the wallboard.</div>}
      {rows.map((row) => {
        const buffer = minutesToWindow(row.nextEta);
        const progressLabel = row.progress?.currentVisit
          ? `${row.progress.currentVisit.geofenceName || "On site"} · ${row.progress.currentVisit.dwellMinutes ?? 0}m`
          : `${row.progress?.completedStops ?? 0}/${row.progress?.totalStops ?? row.etas.length} stops`;
        return <article className={`ops-board-row ${row.status}`} role="row" key={row.id}>
          <span className="time-cell">{formatTime(row.scheduledUtc)}</span>
          <span className="time-cell eta">{formatTime(row.nextEta?.etaUtc)}</span>
          <span className="run-cell"><strong>{row.runLabel}</strong><small>{row.assignment?.trailerNumber ? `Trailer ${row.assignment.trailerNumber}` : row.load?.status || row.progress?.runState || "planned"}</small></span>
          <span><strong>{row.vehicle}</strong><small>{row.nextEta?.source === "Live" ? "live ETA" : "planned ETA"}</small></span>
          <span><strong>{row.driver}</strong><small>{row.nextEta?.tachoDriverName ? "tacho matched" : "allocation / pending"}</small></span>
          <span className="route-cell"><strong>{row.progress?.nextStop?.name || row.nextEta?.stopName || "Next stop TBC"}</strong><small>{row.route}</small></span>
          <span><strong>{progressLabel}</strong><small>{Math.round(row.progress?.progressPercent ?? 0)}% complete</small></span>
          <span><strong>{formatAge(row.nextEta?.trackingUpdatedAtUtc, clock)}</strong><small>{row.nextEta?.source || "Unavailable"}</small></span>
          <span><strong>{tachoText(row.nextEta)}</strong><small>{row.nextEta?.driveAvailableTodayMinutes != null ? `${row.nextEta.driveAvailableTodayMinutes} min drive left` : "hours pending"}</small></span>
          <span className="status-cell"><strong>{row.statusLabel}</strong><small>{buffer == null ? row.statusDetail : `${buffer >= 0 ? "+" : ""}${buffer}m · ${row.statusDetail}`}</small></span>
        </article>;
      })}
    </div>

    <footer className="ops-wallboard-footer">
      <span>Tracker + geofences + TachoMaster only</span>
      <span>ETA risk and job progress view</span>
      <span>Refresh every 20 seconds</span>
      <span>Last refresh {formatAge(lastRefresh, clock)}</span>
    </footer>
  </section>;
}
