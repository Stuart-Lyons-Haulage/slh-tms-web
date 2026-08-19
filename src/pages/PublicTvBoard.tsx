import { useEffect, useMemo, useState } from "react";
import "../tv-display.css";

type TvRun = {
  id: string;
  reference: string;
  status: string;
  driver: string;
  vehicle: string;
  trailer?: string;
  firstPlannedUtc?: string;
  finalPlannedUtc?: string;
  nextStop?: string;
  etaUtc?: string;
  etaSource: string;
  tracking: string;
  trackingUpdatedAtUtc?: string;
  speedKph?: number;
  state: string;
  stateDetail: string;
  priority: number;
};

type TvFeed = {
  planningDate: string;
  generatedAtUtc: string;
  refreshSeconds: number;
  runCount: number;
  runs: TvRun[];
};

const UK_ZONE = "Europe/London";
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: UK_ZONE, hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: UK_ZONE, weekday: "long", day: "2-digit", month: "long", year: "numeric" });

function todayInLondon() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: UK_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function time(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : timeFormat.format(parsed);
}

function stateClass(value: string) {
  const normalised = value.toLowerCase();
  if (normalised.includes("risk") || normalised.includes("stale") || normalised.includes("allocation")) return "tv-state-risk";
  if (normalised.includes("moving")) return "tv-state-moving";
  if (normalised.includes("stationary") || normalised.includes("progress")) return "tv-state-stationary";
  if (normalised.includes("completed")) return "tv-state-complete";
  return "tv-state-upcoming";
}

export function PublicTvBoard() {
  const key = new URLSearchParams(window.location.search).get("key")?.trim() || "";
  const [feed, setFeed] = useState<TvFeed>();
  const [error, setError] = useState<string>();
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState<Date>();
  const date = todayInLondon();

  async function refresh() {
    if (!key) {
      setError("This TV link is missing its display key. Generate the link from the signed-in TMS TV display page.");
      return;
    }
    try {
      const response = await fetch(`/tms-api/api/v1/tv-display/live-runs?date=${encodeURIComponent(date)}&key=${encodeURIComponent(key)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        let detail = "The TV live-runs feed could not be loaded.";
        try { detail = (await response.json() as { message?: string }).message || detail; } catch { /* keep generic detail */ }
        throw new Error(detail);
      }
      setFeed(await response.json() as TvFeed);
      setError(undefined);
      setLastRefresh(new Date());
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The TV live-runs feed could not be loaded.");
    }
  }

  useEffect(() => {
    void refresh();
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    const refreshTimer = window.setInterval(() => void refresh(), 20_000);
    return () => { window.clearInterval(clockTimer); window.clearInterval(refreshTimer); };
  }, [key, date]);

  const metrics = useMemo(() => {
    const rows = feed?.runs || [];
    return {
      active: rows.filter(row => row.state !== "COMPLETED").length,
      moving: rows.filter(row => row.state === "MOVING").length,
      attention: rows.filter(row => row.state.includes("RISK") || row.state.includes("STALE") || row.state.includes("ALLOCATION")).length,
      completed: rows.filter(row => row.state === "COMPLETED").length,
    };
  }, [feed]);

  async function fullScreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  return <div className="tv-display-page">
    <header className="tv-display-header">
      <div className="tv-display-brand"><span>SLH</span><div><small>LIVE OPERATIONS</small><h1>Live Runs</h1></div></div>
      <div className="tv-display-clock"><button type="button" onClick={() => void fullScreen()}>Full screen</button><strong>{timeFormat.format(clock)}</strong><span>{dateFormat.format(clock)}</span></div>
    </header>

    {error && <div className="tv-display-error"><strong>Live feed unavailable</strong><span>{error}</span></div>}

    <section className="tv-display-metrics">
      <article><span>Active runs</span><strong>{metrics.active}</strong></article>
      <article><span>Moving</span><strong>{metrics.moving}</strong></article>
      <article className={metrics.attention ? "attention" : ""}><span>Attention</span><strong>{metrics.attention}</strong></article>
      <article><span>Completed</span><strong>{metrics.completed}</strong></article>
    </section>

    <section className="tv-run-table">
      <div className="tv-run-head"><span>Run</span><span>Allocation</span><span>Next stop</span><span>ETA</span><span>Live status</span></div>
      {(feed?.runs || []).map(run => <article className="tv-run-row" key={run.id}>
        <div className="tv-run-ref"><strong>{run.reference}</strong><small>{run.status}</small></div>
        <div><strong>{run.vehicle}</strong><span>{run.driver}</span><small>{run.trailer ? `Trailer ${run.trailer}` : "Trailer TBC"}</small></div>
        <div><strong>{run.nextStop || (run.state === "COMPLETED" ? "Run complete" : "Next stop TBC")}</strong><small>Start {time(run.firstPlannedUtc)} · finish {time(run.finalPlannedUtc)}</small></div>
        <div className="tv-run-eta"><strong>{run.state === "COMPLETED" ? "✓" : time(run.etaUtc)}</strong><small>{run.etaSource === "Live" ? "LIVE ETA" : run.etaSource.toUpperCase()}</small></div>
        <div className={`tv-run-state ${stateClass(run.state)}`}><strong>{run.state}</strong><span>{run.stateDetail}</span><small>{run.tracking}</small></div>
      </article>)}
      {!error && feed && feed.runs.length === 0 && <div className="tv-display-empty">No runs are planned for today.</div>}
    </section>

    <footer className="tv-display-footer"><span>Read-only display</span><span>UK local time</span><span>Refreshes every {feed?.refreshSeconds || 20} seconds</span><span>{lastRefresh ? `Updated ${timeFormat.format(lastRefresh)}` : "Connecting…"}</span></footer>
  </div>;
}
