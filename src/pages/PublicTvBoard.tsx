import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { formatTime as formatUkTime } from "../lib/dateUtils";
import { displayRunReference } from "../lib/runDisplay";
import "../tv-display.css";

type TvRun = {
  id: string;
  reference: string;
  displayReference?: string;
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

type PairResponse = { key: string; pairedAtUtc: string };
type RunLabelFeed = { planningDate: string; labels: Array<{ loadId: string; displayReference: string }> };

const UK_ZONE = "Europe/London";
const STORAGE_KEY = "slh-tv-display-key";
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: UK_ZONE, hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: UK_ZONE, weekday: "long", day: "2-digit", month: "long", year: "numeric" });

function todayInLondon() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: UK_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function time(value?: string) {
  return formatUkTime(value);
}

function stateClass(value: string) {
  const normalised = value.toLowerCase();
  if (normalised.includes("risk") || normalised.includes("stale") || normalised.includes("allocation")) return "tv-state-risk";
  if (normalised.includes("moving")) return "tv-state-moving";
  if (normalised.includes("stationary") || normalised.includes("progress")) return "tv-state-stationary";
  if (normalised.includes("completed")) return "tv-state-complete";
  return "tv-state-upcoming";
}

function needsAttention(value: string) {
  const normalised = value.toLowerCase();
  return normalised.includes("risk") || normalised.includes("stale") || normalised.includes("allocation");
}

function initialDisplayKey() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const legacy = new URLSearchParams(hash).get("key")?.trim();
  if (legacy) {
    localStorage.setItem(STORAGE_KEY, legacy);
    window.history.replaceState(null, "", window.location.pathname);
    return legacy;
  }
  return localStorage.getItem(STORAGE_KEY)?.trim() || "";
}

export function PublicTvBoard() {
  const [displayKey, setDisplayKey] = useState(initialDisplayKey);
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [feed, setFeed] = useState<TvFeed>();
  const [error, setError] = useState<string>();
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState<Date>();
  const date = todayInLondon();

  const refresh = useCallback(async (key = displayKey) => {
    if (!key) return;
    try {
      const liveRequest = fetch(`/tms-api/api/v1/tv-display/live-runs?date=${encodeURIComponent(date)}`, {
        headers: { Accept: "application/json", "X-TV-Display-Key": key },
        cache: "no-store",
      });
      const labelsRequest = fetch(`/tms-api/api/v1/tv-display/run-labels?date=${encodeURIComponent(date)}`, {
        headers: { Accept: "application/json", "X-TV-Display-Key": key },
        cache: "no-store",
      }).catch(() => undefined);
      const [response, labelResponse] = await Promise.all([liveRequest, labelsRequest]);
      if (response.status === 401) {
        localStorage.removeItem(STORAGE_KEY);
        setDisplayKey("");
        setFeed(undefined);
        setError("This TV needs pairing again. Enter the current 6-digit code from TV display in the signed-in TMS.");
        return;
      }
      if (!response.ok) {
        let detail = "The TV live-runs feed could not be loaded.";
        try { detail = (await response.json() as { message?: string }).message || detail; } catch { /* keep generic detail */ }
        throw new Error(detail);
      }

      const nextFeed = await response.json() as TvFeed;
      if (labelResponse?.ok) {
        try {
          const labelFeed = await labelResponse.json() as RunLabelFeed;
          const labelByLoad = new Map(labelFeed.labels.map(item => [item.loadId, item.displayReference]));
          nextFeed.runs = nextFeed.runs.map(run => ({ ...run, displayReference: labelByLoad.get(run.id) || run.displayReference }));
        } catch { /* fallback below keeps the TV usable during staggered API/web deployments */ }
      }

      setFeed(nextFeed);
      setError(undefined);
      setLastRefresh(new Date());
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The TV live-runs feed could not be loaded.");
    }
  }, [date, displayKey]);

  async function pair(event: FormEvent) {
    event.preventDefault();
    const code = pairCode.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      setError("Enter all 6 digits from the TMS TV display page.");
      return;
    }

    setPairing(true);
    setError(undefined);
    try {
      const response = await fetch("/tms-api/api/v1/tv-display/pair", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        let detail = "That pairing code could not be accepted.";
        try { detail = (await response.json() as { message?: string }).message || detail; } catch { /* keep generic detail */ }
        throw new Error(detail);
      }
      const result = await response.json() as PairResponse;
      localStorage.setItem(STORAGE_KEY, result.key);
      setDisplayKey(result.key);
      setPairCode("");
      await refresh(result.key);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The TV could not be paired.");
    } finally {
      setPairing(false);
    }
  }

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    if (!displayKey) return;
    void refresh(displayKey);
    const refreshTimer = window.setInterval(() => void refresh(displayKey), 20_000);
    return () => window.clearInterval(refreshTimer);
  }, [displayKey, refresh]);

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

  if (!displayKey) {
    return <div className="tv-display-page tv-pair-page">
      <header className="tv-display-header">
        <div className="tv-display-brand"><span>SLH</span><div><small>LIVE OPERATIONS</small><h1>Pair this TV</h1></div></div>
        <div className="tv-display-clock"><strong>{timeFormat.format(clock)}</strong><span>{dateFormat.format(clock)}</span></div>
      </header>
      <section className="tv-pair-card">
        <p className="tv-pair-step">ONE-TIME SETUP</p>
        <h2>Enter the 6-digit TV code</h2>
        <p>On a signed-in phone or computer open <strong>TV display</strong> in the TMS. Enter the code shown there below.</p>
        <form onSubmit={event => void pair(event)}>
          <input
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={pairCode}
            onChange={event => setPairCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            aria-label="Six digit TV pairing code"
          />
          <button className="primary" type="submit" disabled={pairing || pairCode.length !== 6}>{pairing ? "Pairing…" : "Pair TV"}</button>
        </form>
        {error && <div className="tv-display-error"><strong>Pairing not completed</strong><span>{error}</span></div>}
        <p className="tv-pair-hint">Once paired, this television remembers the secure display key and opens Live Runs automatically next time.</p>
      </section>
    </div>;
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
      {(feed?.runs || []).map(run => <article className={`tv-run-row ${needsAttention(run.state) ? "tv-run-row-attention" : ""}`} key={run.id}>
        <div className="tv-run-ref"><strong>{run.displayReference || displayRunReference(run.reference, undefined, run.firstPlannedUtc)}</strong><small>{run.status}</small></div>
        <div><strong>{run.vehicle}</strong><span>{run.driver}</span><small>{run.trailer ? `Trailer ${run.trailer}` : "Trailer TBC"}</small></div>
        <div><strong>{run.nextStop || (run.state === "COMPLETED" ? "Run complete" : "Next stop TBC")}</strong><small>Start {time(run.firstPlannedUtc)} · finish {time(run.finalPlannedUtc)}</small></div>
        <div className="tv-run-eta"><strong>{run.state === "COMPLETED" ? "✓" : time(run.etaUtc)}</strong><small>{run.etaSource === "Live" ? "LIVE ETA" : run.etaSource.toUpperCase()}</small></div>
        <div className={`tv-run-state ${stateClass(run.state)}`}><strong>{run.state}</strong><span>{run.stateDetail}</span><small>{run.tracking}</small></div>
      </article>)}
      {!error && feed && feed.runs.length === 0 && <div className="tv-display-empty">No runs are planned for today.</div>}
    </section>

    <footer className="tv-display-footer"><span>Read-only display</span><span>UK local time · Europe/London</span><span>Refreshes every {feed?.refreshSeconds || 20} seconds</span><span>{lastRefresh ? `Updated ${timeFormat.format(lastRefresh)}` : "Connecting…"}</span></footer>
  </div>;
}
