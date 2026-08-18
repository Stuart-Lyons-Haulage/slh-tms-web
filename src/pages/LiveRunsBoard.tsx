import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DeliveryEta, type FleetStatus, type Load } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";
import "../live-runs.css";

type RunColour = "upcoming" | "stationary" | "on-time" | "at-risk";

type LiveRunRow = {
  load: Load;
  vehicle?: FleetStatus["vehicles"][number];
  registration: string;
  driver: string;
  trailer?: string;
  firstPlannedUtc?: string;
  nextEta?: DeliveryEta;
  finalEta?: DeliveryEta;
  etas: DeliveryEta[];
  status: RunColour;
  statusLabel: string;
  statusDetail: string;
};

const UK_TIME_ZONE = "Europe/London";
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : timeFormatter.format(parsed);
}

function formatAge(value?: string, now = new Date()) {
  if (!value) return "No live update";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No live update";
  const seconds = Math.max(0, Math.round((now.getTime() - parsed.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function statusFor(vehicle: LiveRunRow["vehicle"], etas: DeliveryEta[]) {
  const risk = etas.find((eta) => eta.risk === "Late" || eta.risk === "AtRisk" || eta.tachoStatus === "InsufficientDriveTime");
  if (risk) {
    return {
      status: "at-risk" as const,
      label: "AT RISK",
      detail: risk.tachoStatus === "InsufficientDriveTime" ? "Driver hours affect ETA" : `${risk.stopName} ${risk.risk.toLowerCase()}`,
    };
  }

  if (!vehicle || ["Parked", "Stale", "NotSignedOn"].includes(vehicle.condition)) {
    return {
      status: "upcoming" as const,
      label: "UPCOMING",
      detail: vehicle?.condition === "Stale" ? "Waiting for fresh tracking" : "Awaiting start / movement",
    };
  }

  if (["Stationary", "Started", "SignedOn"].includes(vehicle.condition) && !(vehicle.speedKph && vehicle.speedKph > 2)) {
    return {
      status: "stationary" as const,
      label: "STATIONARY",
      detail: vehicle.condition === "Stationary" ? "Vehicle stationary" : "Signed on / awaiting movement",
    };
  }

  return {
    status: "on-time" as const,
    label: "ON TIME",
    detail: "Live ETA inside planned window",
  };
}

function pickNextEta(etas: DeliveryEta[], now: Date) {
  const sorted = [...etas].sort((left, right) => left.sequence - right.sequence);
  const cutoff = now.getTime() - 15 * 60 * 1000;
  return sorted.find((eta) => !eta.etaUtc || new Date(eta.etaUtc).getTime() >= cutoff) || sorted.at(-1);
}

function averageWindowBuffer(rows: LiveRunRow[]) {
  const minutes = rows.flatMap((row) => {
    const eta = row.nextEta;
    if (!eta?.etaUtc || !eta.deliveryWindowEndUtc) return [];
    const value = Math.round((new Date(eta.deliveryWindowEndUtc).getTime() - new Date(eta.etaUtc).getTime()) / 60000);
    return Number.isFinite(value) ? [value] : [];
  });
  if (!minutes.length) return "—";
  const average = Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length);
  const sign = average >= 0 ? "+" : "−";
  const absolute = Math.abs(average);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function currentTracking(vehicle: LiveRunRow["vehicle"], now: Date) {
  if (!vehicle) return { primary: "No live vehicle match", secondary: "Awaiting DOT/Falcon link" };
  if (vehicle.condition === "Moving") {
    return {
      primary: `Moving · ${Math.round(vehicle.speedKph || 0)} km/h`,
      secondary: `DOT update ${formatAge(vehicle.lastEventTimeUtc, now)}`,
    };
  }
  return {
    primary: vehicle.condition.replace(/([A-Z])/g, " $1").trim(),
    secondary: `DOT update ${formatAge(vehicle.lastEventTimeUtc, now)}`,
  };
}

export function LiveRunsBoard({ tvMode = false }: { tvMode?: boolean }) {
  const token = useAccessToken();
  const date = todayIsoDate();
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState(() => new Date());

  const loads = useApi(useCallback(async () => api.loads(date, await token()), [date, token]));
  const fleet = useApi(useCallback(async () => api.fleetStatus(await token()), [token]));
  const etas = useApi(useCallback(async () => api.deliveryEtas(date, await token()), [date, token]));
  const assignments = useApi(useCallback(async () => api.driverAssignments(date, date, await token()), [date, token]));

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    const refreshTimer = window.setInterval(() => {
      void Promise.all([loads.refresh(), fleet.refresh(), etas.refresh(), assignments.refresh()]).then(() => setLastRefresh(new Date()));
    }, 20000);
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(refreshTimer);
    };
  }, [assignments.refresh, etas.refresh, fleet.refresh, loads.refresh]);

  const rows = useMemo<LiveRunRow[]>(() => {
    const now = clock;
    const fleetById = new Map((fleet.data?.vehicles || []).map((vehicle) => [vehicle.vehicleId, vehicle]));
    const fleetByLoad = new Map((fleet.data?.vehicles || []).filter((vehicle) => vehicle.loadId).map((vehicle) => [vehicle.loadId!, vehicle]));
    const assignmentByLoad = new Map((assignments.data || []).map((assignment) => [assignment.loadId, assignment]));
    const etaByLoad = new Map<string, DeliveryEta[]>();
    for (const eta of etas.data?.records || []) {
      const existing = etaByLoad.get(eta.loadId) || [];
      existing.push(eta);
      etaByLoad.set(eta.loadId, existing);
    }

    return (loads.data || []).map((load) => {
      const assignment = assignmentByLoad.get(load.id);
      const vehicle = fleetByLoad.get(load.id) || (load.vehicleId ? fleetById.get(load.vehicleId) : undefined);
      const runEtas = [...(etaByLoad.get(load.id) || [])].sort((left, right) => left.sequence - right.sequence);
      const nextEta = pickNextEta(runEtas, now);
      const finalEta = runEtas.at(-1);
      const firstStop = [...(load.stops || [])].sort((left, right) => left.sequence - right.sequence)[0];
      const firstPlannedUtc = firstStop?.plannedArrivalUtc || vehicle?.plannedDutyUtc;
      const state = statusFor(vehicle, runEtas);
      return {
        load,
        vehicle,
        registration: assignment?.vehicle?.registration || vehicle?.registration || "Vehicle TBC",
        driver: assignment?.driver?.displayName || vehicle?.driverName || "Driver TBC",
        trailer: assignment?.trailerNumber,
        firstPlannedUtc,
        nextEta,
        finalEta,
        etas: runEtas,
        status: state.status,
        statusLabel: state.label,
        statusDetail: state.detail,
      };
    }).sort((left, right) => {
      const leftTime = left.firstPlannedUtc ? new Date(left.firstPlannedUtc).getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = right.firstPlannedUtc ? new Date(right.firstPlannedUtc).getTime() : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.load.reference.localeCompare(right.load.reference);
    });
  }, [assignments.data, clock, etas.data, fleet.data, loads.data]);

  const onTime = rows.filter((row) => row.status === "on-time").length;
  const stationary = rows.filter((row) => row.status === "stationary").length;
  const atRisk = rows.filter((row) => row.status === "at-risk").length;
  const vehiclesOut = rows.filter((row) => row.status !== "upcoming").length;
  const onTimePercent = rows.length ? Math.round((onTime / rows.length) * 100) : 0;
  const refreshError = loads.error || fleet.error || etas.error || assignments.error;

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  return <section className={`live-runs-board ${tvMode ? "tv-board" : "dashboard-board"}`}>
    <div className="live-runs-topbar">
      <div className="live-runs-title">
        <div className="live-runs-mark">SLH</div>
        <div><p>LIVE OPERATIONS</p><h1>Live Runs</h1></div>
      </div>
      <div className="live-runs-actions">
        {!tvMode && <Link className="live-runs-tv-link" to="/live-runs">Open office TV view</Link>}
        {tvMode && <><Link className="live-runs-tv-link subtle" to="/dashboard">Back to dashboard</Link><button type="button" onClick={() => void toggleFullscreen()}>Full screen</button></>}
        <div className="live-runs-clock"><strong>{timeFormatter.format(clock)}</strong><span>{dateFormatter.format(clock)}</span></div>
      </div>
    </div>

    <div className="live-runs-kpis">
      <article><span className="kpi-icon">▣</span><div><small>Vehicles out</small><strong>{vehiclesOut}<em> / {rows.length}</em></strong></div></article>
      <article className="good"><span className="kpi-icon">✓</span><div><small>On time</small><strong>{onTime}<em> {onTimePercent}%</em></strong></div></article>
      <article className="watch"><span className="kpi-icon">◷</span><div><small>Stationary</small><strong>{stationary}</strong></div></article>
      <article className="bad"><span className="kpi-icon">!</span><div><small>At risk</small><strong>{atRisk}</strong></div></article>
      <article><span className="kpi-icon">◎</span><div><small>Avg window buffer</small><strong>{averageWindowBuffer(rows)}</strong></div></article>
    </div>

    <div className="live-runs-meta">
      <span>↕ Sorted by earliest planned first stop</span>
      <div className="live-runs-legend"><span><i className="dot upcoming" />Upcoming</span><span><i className="dot stationary" />Stationary</span><span><i className="dot on-time" />On time</span><span><i className="dot at-risk" />At risk</span></div>
    </div>

    {refreshError && <div className="live-runs-warning">Live refresh issue: {refreshError}. Last successful data remains on screen.</div>}

    <div className="live-runs-head" aria-hidden="true">
      <span>Vehicle / driver / trailer</span><span>Route / jobs</span><span>First planned</span><span>Window end</span><span>Live ETA / next stop</span><span>Tracking</span><span>Status</span>
    </div>

    <div className="live-runs-list">
      {!loads.data && loads.loading && <div className="live-runs-empty">Loading today’s runs…</div>}
      {loads.data && rows.length === 0 && <div className="live-runs-empty">No runs have been generated for today yet.</div>}
      {rows.map((row) => {
        const tracking = currentTracking(row.vehicle, clock);
        const sortedStops = [...(row.load.stops || [])].sort((left, right) => left.sequence - right.sequence);
        const currentSequence = row.nextEta?.sequence;
        return <article className={`live-run-row ${row.status}`} key={row.load.id}>
          <div className="run-identity">
            <span className="run-truck">▰</span>
            <div><strong>{row.registration}</strong><span>{row.driver}</span><small>{row.trailer || row.load.reference}</small></div>
          </div>
          <div className="run-route">
            <strong>{sortedStops.length ? sortedStops.map((stop) => stop.name).join(" → ") : row.load.reference}</strong>
            {sortedStops.length > 0 && <div className="run-progress" aria-label={`${sortedStops.length} planned stops`}>
              {sortedStops.map((stop) => <i key={stop.id} className={currentSequence && stop.sequence < currentSequence ? "done" : currentSequence === stop.sequence ? "current" : ""} />)}
            </div>}
          </div>
          <div className="run-time"><strong>{formatTime(row.firstPlannedUtc)}</strong><small>{sortedStops[0]?.name || "First stop TBC"}</small></div>
          <div className="run-time"><strong>{formatTime(row.finalEta?.deliveryWindowEndUtc)}</strong><small>{row.finalEta?.stopName || "Window TBC"}</small></div>
          <div className="run-eta"><strong>{formatTime(row.nextEta?.etaUtc)}</strong><small>{row.nextEta?.stopName || "ETA calculating"}</small></div>
          <div className="run-tracking"><strong>{tracking.primary}</strong><small>{tracking.secondary}</small></div>
          <div className="run-status"><span>{row.statusLabel}</span><small>{row.statusDetail}</small>{!tvMode && <Link to={`/timeline/run/${row.load.id}`}>Open run →</Link>}</div>
        </article>;
      })}
    </div>

    <footer className="live-runs-footer"><span>UK time</span><span>ETA and tracking refresh every 20 seconds</span><span>Refreshed {formatAge(lastRefresh, clock)}</span></footer>
  </section>;
}
