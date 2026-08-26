import { useEffect, useState } from "react";
import { OperationsWallboardStability } from "./OperationsWallboardStability";

type CachedTimingResponse = {
  body: string;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  savedAt: number;
};

const TIMING_CACHE_MAX_AGE_MS = 90_000;
const TIMING_REFRESH_AFTER_MS = 10_000;
const TIMING_BACKGROUND_TIMEOUT_MS = 12_000;

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function isRunTimingRequest(url: string) {
  return url.includes("/api/v1/run-timing");
}

function timingFallback(url: string) {
  let planningDate = "";
  try { planningDate = new URL(url, window.location.origin).searchParams.get("date") || ""; }
  catch { /* Keep the fallback date blank rather than blocking the wallboard. */ }

  return new Response(JSON.stringify({
    planningDate,
    calculatedAtUtc: new Date().toISOString(),
    geofenceAvailable: false,
    records: [],
  }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function cachedResponse(cached: CachedTimingResponse) {
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

/**
 * Resilience boundary for the operational wallboard.
 *
 * /run-timing can legitimately be slower than the lightweight plan feeds because it
 * rebuilds geofence evidence and routes remaining legs. It must therefore never hold
 * the basic wallboard open. The first request fails open immediately while a bounded
 * background refresh warms a short-lived cache. Later refreshes can use the last good
 * timing snapshot while a fresh calculation is collected in the background.
 */
export function OperationsWallboard({ tvMode = false }: { tvMode?: boolean }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const cache = new Map<string, CachedTimingResponse>();
    const inFlight = new Map<string, Promise<void>>();

    const refreshTiming = (input: RequestInfo | URL, init: RequestInit | undefined, url: string) => {
      const existing = inFlight.get(url);
      if (existing) return existing;

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), TIMING_BACKGROUND_TIMEOUT_MS);
      const operation = (async () => {
        try {
          const response = await originalFetch(input, {
            ...init,
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) return;

          const body = await response.text();
          cache.set(url, {
            body,
            status: response.status,
            statusText: response.statusText,
            headers: Array.from(response.headers.entries()),
            savedAt: Date.now(),
          });
        } catch {
          // The wallboard intentionally keeps the previous/live plan feeds when timing is slow.
        } finally {
          window.clearTimeout(timeout);
          inFlight.delete(url);
        }
      })();

      inFlight.set(url, operation);
      return operation;
    };

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (!isRunTimingRequest(url)) return originalFetch(input, init);

      const cached = cache.get(url);
      const age = cached ? Date.now() - cached.savedAt : Number.POSITIVE_INFINITY;
      if (cached && age <= TIMING_CACHE_MAX_AGE_MS) {
        if (age >= TIMING_REFRESH_AFTER_MS) void refreshTiming(input, init, url);
        return cachedResponse(cached);
      }

      void refreshTiming(input, init, url);
      return timingFallback(url);
    };

    window.fetch = patchedFetch;
    setReady(true);
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  if (!ready) return <section className="ops-wallboard"><div className="ops-board-empty">Loading operations wallboard...</div></section>;
  return <OperationsWallboardStability tvMode={tvMode} />;
}
