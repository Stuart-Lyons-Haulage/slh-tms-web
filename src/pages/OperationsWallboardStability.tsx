import { useEffect, useState } from "react";
import { OperationsWallboardGeofenceTimed as ExistingOperationsWallboard } from "./OperationsWallboardGeofenceTimed";

type StopDwell = { stopId?: string; sequence?: number };
type Visit = {
  loadStopId?: string;
  enteredAtUtc?: string;
  confirmedAtUtc?: string;
  isDelayed?: boolean;
  dwellMinutes?: number;
  liveDwellMinutes?: number;
  liveDwellSeconds?: number;
};
type ProgressRecord = {
  loadId?: string;
  totalStops?: number;
  completedStops?: number;
  currentVisit?: Visit | null;
  stopDwell?: StopDwell[];
};
type RouteRun = ProgressRecord & { stops?: Array<{ id?: string; sequence?: number }> };
type EtaRecord = {
  loadId?: string;
  stopId?: string;
  sequence?: number;
  etaUtc?: string;
  source?: string;
  trackingUpdatedAtUtc?: string;
  risk?: string;
  [key: string]: unknown;
};
type CachedEta = { record: EtaRecord; seenAt: number };

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

function etaKey(record: EtaRecord) {
  return `${record.loadId || ""}|${record.stopId || ""}|${record.sequence ?? ""}`;
}

function hasUsefulEta(record?: EtaRecord) {
  if (!record?.etaUtc) return false;
  const source = String(record.source || "").toLowerCase();
  return source === "live" || source === "estimated" || source === "geofence" || source === "geofenceestimated";
}

export function isFinalCurrentVisit(record: ProgressRecord) {
  if (!record.currentVisit || !record.totalStops || record.totalStops <= 0) return false;
  const sequence = record.stopDwell?.find(stop => stop.stopId && stop.stopId === record.currentVisit?.loadStopId)?.sequence;
  if (sequence != null) return sequence === record.totalStops;
  return (record.completedStops ?? 0) === record.totalStops - 1;
}

export function normaliseFinalArrival<T extends ProgressRecord>(record: T): T {
  if (!isFinalCurrentVisit(record) || !record.currentVisit) return record;
  return {
    ...record,
    currentVisit: {
      ...record.currentVisit,
      isDelayed: false,
      confirmedAtUtc: undefined,
      dwellMinutes: 0,
      liveDwellMinutes: undefined,
      liveDwellSeconds: undefined,
    },
  };
}

export function retainUsefulEtas(current: EtaRecord[], cache: Map<string, CachedEta>, activeLoadIds: Set<string>, now = Date.now()) {
  const next = current.map(record => {
    const key = etaKey(record);
    if (hasUsefulEta(record)) {
      cache.set(key, { record, seenAt: now });
      return record;
    }
    const cached = cache.get(key);
    if (!cached || now - cached.seenAt > ETA_RETENTION_MS || !record.loadId || !activeLoadIds.has(record.loadId)) return record;
    return {
      ...record,
      etaUtc: cached.record.etaUtc,
      source: cached.record.source,
      trackingUpdatedAtUtc: cached.record.trackingUpdatedAtUtc,
      risk: cached.record.risk ?? record.risk,
    };
  });

  const present = new Set(next.map(etaKey));
  for (const [key, cached] of cache) {
    if (now - cached.seenAt > ETA_RETENTION_MS) {
      cache.delete(key);
      continue;
    }
    const loadId = cached.record.loadId;
    if (!loadId || !activeLoadIds.has(loadId) || present.has(key)) continue;
    next.push(cached.record);
  }
  return next;
}

function tidyFinalArrivalRows() {
  document.querySelectorAll<HTMLElement>(".ops-board-row").forEach(row => {
    const etaLabel = row.querySelector<HTMLElement>(".time-cell.eta small");
    if (!etaLabel?.textContent?.startsWith("ARRIVED")) return;
    const focus = row.querySelector<HTMLElement>(".run-cell small")?.textContent?.trim() || "Final destination";
    const progress = row.querySelector<HTMLElement>(".progress-cell > strong");
    const statusDetail = row.querySelector<HTMLElement>(".status-cell small");
    if (progress && /time on site/i.test(progress.textContent || "")) progress.textContent = `${focus} · ARRIVED`;
    if (statusDetail) statusDetail.textContent = "Final destination reached";
  });
}

/**
 * Final wallboard guard layer.
 * Keeps the last good ETA through short-lived sparse refreshes, treats a live visit
 * at the final planned stop as ARRIVED rather than DWELL/SITE DELAY, and prevents
 * the TV layout from oscillating when live rows refresh.
 */
export function OperationsWallboardStability({ tvMode = false }: { tvMode?: boolean }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const etaCache = new Map<string, CachedEta>();
    const activeLoadIds = new Set<string>();

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (!response.ok) return response;
      const url = requestUrl(input);
      const isLoads = /\/api\/v1\/loads(?:\?|$)/.test(url);
      const isEta = url.includes("/api/v1/operations/delivery-etas");
      const isProgress = url.includes("/api/v1/run-progress");
      const isRoute = url.includes("/api/v1/tv-display/route-progress");
      if (!isLoads && !isEta && !isProgress && !isRoute) return response;

      try {
        const payload = await response.clone().json();
        if (isLoads && Array.isArray(payload)) {
          activeLoadIds.clear();
          for (const load of payload as Array<{ id?: string; status?: string }>) {
            if (load.id && load.status !== "Cancelled" && load.status !== "Completed") activeLoadIds.add(load.id);
          }
          return response;
        }
        if (isEta && payload && Array.isArray(payload.records)) {
          return jsonResponse(response, { ...payload, records: retainUsefulEtas(payload.records as EtaRecord[], etaCache, activeLoadIds) });
        }
        if (isProgress && payload && Array.isArray(payload.records)) {
          return jsonResponse(response, { ...payload, records: (payload.records as ProgressRecord[]).map(normaliseFinalArrival) });
        }
        if (isRoute && payload && Array.isArray(payload.runs)) {
          return jsonResponse(response, { ...payload, runs: (payload.runs as RouteRun[]).map(normaliseFinalArrival) });
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
    tidyFinalArrivalRows();
    const observer = new MutationObserver(tidyFinalArrivalRows);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [ready]);

  if (!ready) return <section className="ops-wallboard"><div className="ops-board-empty">Loading stable live wallboard...</div></section>;
  return <ExistingOperationsWallboard tvMode={tvMode} />;
}
