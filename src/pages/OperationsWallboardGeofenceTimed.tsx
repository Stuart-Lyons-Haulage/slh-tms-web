import { useEffect, useState } from "react";
import { OperationsWallboard as ExistingOperationsWallboard } from "./OperationsWallboardLive";

type TimingRecord = {
  loadId: string;
  completed: boolean;
  nextStopId?: string;
  nextStopSequence?: number;
  nextEtaUtc?: string;
  etaSource?: string;
  finalEtaUtc?: string;
  finalEtaSource?: string;
  previousGeofenceDepartureUtc?: string;
  dwellStartedAtUtc?: string;
  currentGeofenceName?: string;
};
type TimingResponse = { planningDate: string; geofenceAvailable: boolean; records: TimingRecord[] };

type CachedTiming = { expiresAt: number; promise: Promise<TimingResponse | undefined> };

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
}

function timingUrl(sourceUrl: string, date: string) {
  const parsed = new URL(sourceUrl, window.location.origin);
  const apiIndex = parsed.pathname.indexOf("/api/v1/");
  const prefix = apiIndex >= 0 ? parsed.pathname.slice(0, apiIndex) : "";
  return `${prefix}/api/v1/run-timing?date=${encodeURIComponent(date)}`;
}

function dateFromUrl(sourceUrl: string) {
  try { return new URL(sourceUrl, window.location.origin).searchParams.get("date") || undefined; }
  catch { return undefined; }
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

function isCompletedProgress(record: { runState?: string; totalStops?: number; completedStops?: number }) {
  return record.runState === "Completed" || Boolean(record.totalStops && record.completedStops === record.totalStops);
}

function mappedEtaSource(source?: string) {
  return source === "Geofence" ? "Live" : source === "GeofenceEstimated" ? "Estimated" : undefined;
}

function relabelCollectionTiming() {
  const board = document.querySelector<HTMLElement>(".ops-wallboard");
  if (!board) return;
  const firstHeader = board.querySelector<HTMLElement>(".ops-board-head > span:first-child");
  if (firstHeader && firstHeader.textContent !== "Collection due") firstHeader.textContent = "Collection due";
  board.querySelectorAll<HTMLElement>(".ops-board-row .time-cell > small").forEach(label => {
    if (label.textContent === "planned start") label.textContent = "first collection due";
  });
}

/**
 * Wallboard-only adapter:
 * - current site dwell continues to come from run-progress and therefore starts at first geofence entry;
 * - between stops, the displayed next ETA is replaced with previous geofence departure + route time;
 * - the displayed final ETA comes from the cumulative geofence route, including intermediate dwell projection;
 * - the CSV/planner final delivery latest time is retained as the final ETA risk deadline;
 * - once all stops are geofence-departed, the run is removed from the wallboard/TV data feeds;
 * - the first time column is labelled as the first collection due time, not a driver start time.
 */
export function OperationsWallboardGeofenceTimed({ tvMode = false }: { tvMode?: boolean }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const cache = new Map<string, CachedTiming>();

    const getTiming = (sourceUrl: string, input: RequestInfo | URL, init?: RequestInit) => {
      const date = dateFromUrl(sourceUrl);
      if (!date) return Promise.resolve(undefined);
      const existing = cache.get(date);
      if (existing && existing.expiresAt > Date.now()) return existing.promise;

      const promise = originalFetch(timingUrl(sourceUrl, date), {
        method: "GET",
        headers: requestHeaders(input, init),
        cache: "no-store",
      }).then(async response => response.ok ? await response.json() as TimingResponse : undefined)
        .catch(() => undefined);
      cache.set(date, { expiresAt: Date.now() + 5000, promise });
      return promise;
    };

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (!response.ok) return response;

      const url = requestUrl(input);
      const isLoads = /\/api\/v1\/loads(?:\?|$)/.test(url);
      const isEta = url.includes("/api/v1/operations/delivery-etas");
      const isProgress = url.includes("/api/v1/run-progress");
      const isRouteProgress = url.includes("/api/v1/tv-display/route-progress");
      if (!isLoads && !isEta && !isProgress && !isRouteProgress) return response;

      try {
        const payload = await response.clone().json();

        if (isProgress && payload && Array.isArray(payload.records)) {
          return jsonResponse(response, {
            ...payload,
            records: payload.records.filter((record: { runState?: string; totalStops?: number; completedStops?: number }) => !isCompletedProgress(record)),
          });
        }

        const timing = await getTiming(url, input, init);
        if (!timing?.geofenceAvailable) return response;
        const timingByLoad = new Map(timing.records.map(record => [record.loadId, record]));
        const completed = new Set(timing.records.filter(record => record.completed).map(record => record.loadId));

        if (isLoads && Array.isArray(payload)) {
          return jsonResponse(response, payload.filter((load: { id?: string }) => !load.id || !completed.has(load.id)));
        }

        if (isEta && payload && Array.isArray(payload.records)) {
          const finalSequenceByLoad = new Map<string, number>();
          for (const eta of payload.records as Array<{ loadId?: string; sequence?: number }>) {
            if (!eta.loadId || eta.sequence == null) continue;
            finalSequenceByLoad.set(eta.loadId, Math.max(finalSequenceByLoad.get(eta.loadId) ?? eta.sequence, eta.sequence));
          }

          const records = payload.records
            .filter((eta: { loadId?: string }) => !eta.loadId || !completed.has(eta.loadId))
            .map((eta: { loadId?: string; stopId?: string; sequence?: number; etaUtc?: string; source?: string; deliveryWindowEndUtc?: string }) => {
              if (!eta.loadId) return eta;
              const anchor = timingByLoad.get(eta.loadId);
              if (!anchor) return eta;

              const isNextStop = Boolean(anchor.nextStopId && eta.stopId === anchor.nextStopId) ||
                anchor.nextStopSequence != null && eta.sequence === anchor.nextStopSequence;
              const isFinalStop = eta.sequence != null && eta.sequence === finalSequenceByLoad.get(eta.loadId);

              if (isFinalStop && anchor.finalEtaUtc) {
                const finalDeliveryLatestUtc = eta.deliveryWindowEndUtc || (eta.source === "Planned" ? eta.etaUtc : undefined);
                return {
                  ...eta,
                  etaUtc: anchor.finalEtaUtc,
                  source: mappedEtaSource(anchor.finalEtaSource) || eta.source,
                  deliveryWindowEndUtc: finalDeliveryLatestUtc,
                };
              }
              if (isNextStop && anchor.nextEtaUtc) {
                return {
                  ...eta,
                  etaUtc: anchor.nextEtaUtc,
                  source: mappedEtaSource(anchor.etaSource) || eta.source,
                };
              }
              return eta;
            });
          return jsonResponse(response, { ...payload, records });
        }

        if (isRouteProgress && payload && Array.isArray(payload.runs)) {
          return jsonResponse(response, {
            ...payload,
            runs: payload.runs.filter((run: { loadId?: string }) => !run.loadId || !completed.has(run.loadId)),
          });
        }
      } catch {
        return response;
      }

      return response;
    };

    window.fetch = patchedFetch;
    setReady(true);
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    relabelCollectionTiming();
    const observer = new MutationObserver(relabelCollectionTiming);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [ready]);

  if (!ready) return <section className="ops-wallboard"><div className="ops-board-empty">Loading live geofence timing...</div></section>;
  return <ExistingOperationsWallboard tvMode={tvMode} />;
}
