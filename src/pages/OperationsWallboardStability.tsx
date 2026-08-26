import { useEffect, useState } from "react";
import { OperationsWallboardGeofenceTimed as ExistingOperationsWallboard } from "./OperationsWallboardGeofenceTimed";
import {
  normaliseFinalArrival,
  retainUsefulEtas,
  type CachedEta,
  type EtaRecord,
  type ProgressRecord,
  type RouteRun,
} from "./operationsWallboardStabilityLogic";

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
