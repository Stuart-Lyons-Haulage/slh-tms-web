import { useEffect, useState } from "react";
import { OperationsWallboard as ExistingOperationsWallboard } from "./OperationsWallboardLive";

type TimingRecord = {
  loadId: string;
  loadReference?: string;
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
type LoadSnapshot = {
  id?: string;
  reference?: string;
  status?: string;
  stops?: Array<{ id?: string; sequence?: number; name?: string; plannedArrivalUtc?: string }>;
};
type EtaRecord = {
  loadId?: string;
  loadReference?: string;
  loadStatus?: string;
  stopId?: string;
  sequence?: number;
  stopName?: string;
  etaUtc?: string;
  source?: string;
  deliveryWindowEndUtc?: string;
  risk?: string;
  routeDrivingMinutes?: number;
  breakMinutesIncluded?: number;
  tachoStatus?: string;
  tachoExplanation?: string;
};

type CachedTiming = { expiresAt: number; promise: Promise<TimingResponse | undefined> };
type CachedLoads = { expiresAt: number; promise: Promise<LoadSnapshot[]> };

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
}

function apiUrl(sourceUrl: string, path: string, date: string) {
  const parsed = new URL(sourceUrl, window.location.origin);
  const apiIndex = parsed.pathname.indexOf("/api/v1/");
  const prefix = apiIndex >= 0 ? parsed.pathname.slice(0, apiIndex) : "";
  return `${prefix}/api/v1/${path}?date=${encodeURIComponent(date)}`;
}

function timingUrl(sourceUrl: string, date: string) {
  return apiUrl(sourceUrl, "run-timing", date);
}

function loadsUrl(sourceUrl: string, date: string) {
  return apiUrl(sourceUrl, "loads", date);
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

function addMinutes(value: string | undefined, minutes?: number) {
  if (!value || !minutes || minutes <= 0) return value;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + minutes * 60_000).toISOString() : value;
}

// eslint-disable-next-line react-refresh/only-export-components
export function syntheticTimingEtas(load: LoadSnapshot, anchor: TimingRecord): EtaRecord[] {
  if (!load.id) return [];
  const stops = [...(load.stops || [])]
    .filter(stop => stop.id && stop.sequence != null)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
  if (!stops.length) return [];

  const next = stops.find(stop => Boolean(anchor.nextStopId && stop.id === anchor.nextStopId)
    || anchor.nextStopSequence != null && stop.sequence === anchor.nextStopSequence);
  const final = stops.at(-1);
  const selected = next && final && next.id !== final.id ? [next, final] : [final || next].filter(Boolean);

  return selected.map(stop => {
    const isNext = Boolean(anchor.nextStopId && stop?.id === anchor.nextStopId)
      || anchor.nextStopSequence != null && stop?.sequence === anchor.nextStopSequence;
    const isFinal = stop?.id === final?.id;
    const timingEta = isFinal ? anchor.finalEtaUtc : isNext ? anchor.nextEtaUtc : undefined;
    const timingSource = isFinal ? anchor.finalEtaSource : isNext ? anchor.etaSource : undefined;
    const planned = stop?.plannedArrivalUtc;
    return {
      loadId: load.id,
      loadReference: anchor.loadReference || load.reference,
      loadStatus: load.status || "Planned",
      stopId: stop?.id,
      sequence: stop?.sequence,
      stopName: stop?.name || "Planned stop",
      etaUtc: timingEta || planned,
      source: timingEta ? mappedEtaSource(timingSource) || "Estimated" : planned ? "Planned" : "Unavailable",
      deliveryWindowEndUtc: isFinal ? planned : undefined,
      risk: "Pending",
      routeDrivingMinutes: 0,
      breakMinutesIncluded: 0,
      tachoStatus: "Unavailable",
      tachoExplanation: "Geofence run-timing supplied the active ETA while the primary delivery ETA feed was unavailable after reset/re-import.",
    };
  });
}

function relabelOperationalEvidence() {
  const board = document.querySelector<HTMLElement>(".ops-wallboard");
  if (!board) return;
  const firstHeader = board.querySelector<HTMLElement>(".ops-board-head > span:first-child");
  if (firstHeader && firstHeader.textContent !== "Collection due") firstHeader.textContent = "Collection due";
  board.querySelectorAll<HTMLElement>(".ops-board-row .time-cell > small").forEach(label => {
    if (label.textContent === "planned start") label.textContent = "first collection due";
  });

  board.querySelectorAll<HTMLElement>(".ops-board-row > span:nth-child(4) > small").forEach(label => {
    const text = (label.textContent || "").trim();
    let nextText = text;
    if (/^signed on\b/i.test(text)) nextText = text.replace(/^signed on\b/i, "SIGNED ON");
    else if (/^card confirmed\b/i.test(text)) nextText = text.replace(/^card confirmed\b/i, "CARD CONFIRMED");
    else if (/^sign-on evidence unavailable$/i.test(text)) nextText = "NOT SIGNED ON";
    else if (/^tacho mismatch$/i.test(text)) nextText = "TACHO MISMATCH";
    else if (/^TachoMaster unavailable$/i.test(text) || /^tacho unavailable$/i.test(text) || /^TachoMaster evidence missing$/i.test(text)) nextText = "TACHO UNAVAILABLE";
    else if (/^no planned driver$/i.test(text)) nextText = "NO PLANNED DRIVER";
    else if (/^no planned vehicle$/i.test(text)) nextText = "NO PLANNED VEHICLE";
    if (nextText !== text) label.textContent = nextText;
  });
}

/**
 * Wallboard-only adapter:
 * - current site dwell continues to come from run-progress and therefore starts at first geofence entry;
 * - between stops, the displayed next ETA is replaced with previous geofence departure/live position + HGV traffic route time;
 * - the displayed final ETA comes from the cumulative geofence/HGV route, including intermediate dwell projection;
 * - TachoMaster break minutes from the primary ETA feed are added to the geofence-timed next/final ETA so legal driving constraints are not lost;
 * - the CSV/planner final delivery latest time is retained as the final ETA risk deadline;
 * - when reset/re-import leaves the primary delivery ETA feed empty, missing rows are rebuilt from run-timing + imported stops;
 * - once all stops are geofence-departed, the run is removed from the wallboard/TV data feeds;
 * - the first time column is labelled as the first collection due time, not a driver start time;
 * - the driver evidence line is explicit: SIGNED ON, NOT SIGNED ON, CARD CONFIRMED, TACHO MISMATCH or TACHO UNAVAILABLE.
 */
export function OperationsWallboardGeofenceTimed({ tvMode = false }: { tvMode?: boolean }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const cache = new Map<string, CachedTiming>();
    const loadsCache = new Map<string, CachedLoads>();

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

    const getLoads = (sourceUrl: string, input: RequestInfo | URL, init?: RequestInit) => {
      const date = dateFromUrl(sourceUrl);
      if (!date) return Promise.resolve([] as LoadSnapshot[]);
      const existing = loadsCache.get(date);
      if (existing && existing.expiresAt > Date.now()) return existing.promise;

      const promise = originalFetch(loadsUrl(sourceUrl, date), {
        method: "GET",
        headers: requestHeaders(input, init),
        cache: "no-store",
      }).then(async response => response.ok ? await response.json() as LoadSnapshot[] : [])
        .catch(() => [] as LoadSnapshot[]);
      loadsCache.set(date, { expiresAt: Date.now() + 5000, promise });
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
          for (const eta of payload.records as EtaRecord[]) {
            if (!eta.loadId || eta.sequence == null) continue;
            finalSequenceByLoad.set(eta.loadId, Math.max(finalSequenceByLoad.get(eta.loadId) ?? eta.sequence, eta.sequence));
          }

          const records: EtaRecord[] = (payload.records as EtaRecord[])
            .filter(eta => !eta.loadId || !completed.has(eta.loadId))
            .map(eta => {
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
                  etaUtc: addMinutes(anchor.finalEtaUtc, eta.breakMinutesIncluded),
                  source: mappedEtaSource(anchor.finalEtaSource) || eta.source,
                  deliveryWindowEndUtc: finalDeliveryLatestUtc,
                };
              }
              if (isNextStop && anchor.nextEtaUtc) {
                return {
                  ...eta,
                  etaUtc: addMinutes(anchor.nextEtaUtc, eta.breakMinutesIncluded),
                  source: mappedEtaSource(anchor.etaSource) || eta.source,
                };
              }
              return eta;
            });

          const loads = await getLoads(url, input, init);
          for (const load of loads) {
            if (!load.id || completed.has(load.id) || records.some(eta => eta.loadId === load.id)) continue;
            const anchor = timingByLoad.get(load.id);
            if (!anchor) continue;
            records.push(...syntheticTimingEtas(load, anchor));
          }
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
    relabelOperationalEvidence();
    let frame: number | undefined;
    const observer = new MutationObserver(() => {
      if (frame != null) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        relabelOperationalEvidence();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [ready]);

  if (!ready) return <section className="ops-wallboard"><div className="ops-board-empty">Loading live geofence timing...</div></section>;
  return <ExistingOperationsWallboard tvMode={tvMode} />;
}
