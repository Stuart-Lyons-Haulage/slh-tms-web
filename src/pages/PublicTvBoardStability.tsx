import { useEffect, useState } from "react";
import { PublicTvBoard as ExistingPublicTvBoard } from "./PublicTvBoard";

type TvRun = {
  id?: string;
  etaUtc?: string;
  etaSource?: string;
  state?: string;
  stateDetail?: string;
  finalStop?: string;
  nextStop?: string;
  siteArrivalUtc?: string;
  dwellState?: string;
  liveDwellMinutes?: number;
  liveDwellSeconds?: number;
  priority?: number;
  [key: string]: unknown;
};
type CachedRun = { run: TvRun; seenAt: number };

const ETA_RETENTION_MS = 5 * 60 * 1000;

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function jsonResponse(original: Response, payload: unknown) {
  const headers = new Headers(original.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  return new Response(JSON.stringify(payload), {
    status: original.status,
    statusText: original.statusText,
    headers,
  });
}

function hasUsefulEta(run: TvRun) {
  if (!run.etaUtc) return false;
  const source = String(run.etaSource || "").toLowerCase();
  return source === "live" || source === "estimated" || source === "geofence" || source === "geofenceestimated" || source === "planned";
}

function isFinalOnSite(run: TvRun) {
  return run.dwellState === "OnSite" && Boolean(run.siteArrivalUtc) && Boolean(run.finalStop) && run.nextStop === run.finalStop;
}

export function stabiliseTvRuns(current: TvRun[], cache: Map<string, CachedRun>, now = Date.now()) {
  const currentIds = new Set(current.map(run => run.id).filter((id): id is string => Boolean(id)));
  for (const key of [...cache.keys()]) if (!currentIds.has(key)) cache.delete(key);

  return current.map(run => {
    if (!run.id) return run;
    const previous = cache.get(run.id);
    let stable = run;
    if (!hasUsefulEta(run) && previous && now - previous.seenAt <= ETA_RETENTION_MS && hasUsefulEta(previous.run)) {
      stable = { ...run, etaUtc: previous.run.etaUtc, etaSource: previous.run.etaSource };
    }
    if (isFinalOnSite(stable)) {
      stable = {
        ...stable,
        state: "ARRIVED",
        stateDetail: `${stable.finalStop || "Final destination"} · arrived ${stable.siteArrivalUtc ? "at final stop" : ""}`.trim(),
        etaUtc: stable.siteArrivalUtc,
        etaSource: "Arrived",
        dwellState: "EnRoute",
        liveDwellMinutes: undefined,
        liveDwellSeconds: undefined,
        priority: Math.min(Number(stable.priority ?? 70), 70),
      };
    }
    cache.set(run.id, { run: stable, seenAt: hasUsefulEta(stable) ? now : previous?.seenAt ?? now });
    return stable;
  });
}

/**
 * Public TV guard for the paired /tv route. It mirrors the operations wallboard's
 * terminal-arrival rule and prevents a short sparse live-runs refresh from erasing
 * an ETA that was valid on the preceding refresh.
 */
export function PublicTvBoardStability() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const cache = new Map<string, CachedRun>();

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (!response.ok || !requestUrl(input).includes("/api/v1/tv-display/live-runs")) return response;
      try {
        const payload = await response.clone().json();
        if (!payload || !Array.isArray(payload.runs)) return response;
        const runs = stabiliseTvRuns(payload.runs as TvRun[], cache);
        return jsonResponse(response, { ...payload, runCount: runs.length, runs });
      } catch {
        return response;
      }
    };

    window.fetch = patchedFetch;
    setReady(true);
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  if (!ready) return null;
  return <ExistingPublicTvBoard />;
}
