import { useEffect } from "react";
import { OperationsWallboard as ExistingOperationsWallboard } from "./OperationsWallboardLive";
import { RunGeofenceLinkagePanel } from "./RunGeofenceLinkagePanel";
import { EtaLearningBridge } from "./EtaLearningBridge";
import "../run-geofence-linkage.css";
import "../operations-wallboard-brand.css";
import "../operations-wallboard-kpi-compat.css";

type CachedWallboardResponse = {
  body: string;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  cachedAt: number;
};

const wallboardResponseCache = new Map<string, CachedWallboardResponse>();
const WALLBOARD_CACHE_PREFIX = "slh-wallboard-response:";
const WALLBOARD_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
let wallboardFetchInstalled = false;

function stableWallboardCacheKey(url: URL) {
  const copy = new URL(url.toString());
  copy.searchParams.delete("key");
  copy.searchParams.delete("_ts");
  copy.searchParams.sort();
  return `${copy.pathname}?${copy.searchParams.toString()}`;
}

function readStoredWallboardResponse(cacheKey: string) {
  const memory = wallboardResponseCache.get(cacheKey);
  if (memory && Date.now() - memory.cachedAt <= WALLBOARD_CACHE_MAX_AGE_MS) return memory;
  if (memory) wallboardResponseCache.delete(cacheKey);
  try {
    const raw = window.sessionStorage.getItem(`${WALLBOARD_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as CachedWallboardResponse;
    if (!cached?.body || Date.now() - Number(cached.cachedAt || 0) > WALLBOARD_CACHE_MAX_AGE_MS) {
      window.sessionStorage.removeItem(`${WALLBOARD_CACHE_PREFIX}${cacheKey}`);
      return undefined;
    }
    wallboardResponseCache.set(cacheKey, cached);
    return cached;
  } catch {
    return undefined;
  }
}

function writeStoredWallboardResponse(cacheKey: string, response: Response, body: string) {
  const cached: CachedWallboardResponse = {
    body,
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    cachedAt: Date.now(),
  };
  wallboardResponseCache.set(cacheKey, cached);
  try {
    window.sessionStorage.setItem(`${WALLBOARD_CACHE_PREFIX}${cacheKey}`, JSON.stringify(cached));
  } catch {
    // An in-memory warm cache still prevents repeated cold loads if session storage is blocked.
  }
}

function responseFromCache(cached?: CachedWallboardResponse) {
  if (!cached) return undefined;
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

function installWallboardFetchResilience() {
  if (wallboardFetchInstalled || typeof window === "undefined" || typeof window.fetch !== "function") return;
  wallboardFetchInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    let url: URL | undefined;
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      url = new URL(raw, window.location.origin);
    } catch {
      return originalFetch(input, init);
    }

    const isWallboardRead = method === "GET"
      && url.origin === window.location.origin
      && url.pathname.startsWith("/tms-api/api/v1/")
      && (
        url.pathname.includes("/tv-display/")
        || url.pathname.includes("/run-progress")
        || url.pathname.includes("/run-timing")
        || url.pathname.includes("/operations/delivery-etas")
        || url.pathname.includes("/driver-assignments")
      );

    if (!isWallboardRead) return originalFetch(input, init);

    // The six-digit pairing flow issues a database-backed TV key. A couple of legacy
    // wallboard endpoints still accept only the server wallboard key, so paired TVs use
    // a read-only API proxy that validates the paired key server-side and calls those
    // feeds with the server credential. Signed-in TMS traffic continues to use the
    // original endpoints directly.
    if (url.searchParams.has("key")) {
      if (url.pathname.endsWith("/operations/delivery-etas"))
        url.pathname = "/tms-api/api/v1/tv-display/wallboard-proxy/delivery-etas";
      else if (url.pathname.endsWith("/run-progress"))
        url.pathname = "/tms-api/api/v1/tv-display/wallboard-proxy/run-progress";
    }

    const fetchInput: RequestInfo | URL = input instanceof Request
      ? new Request(url.toString(), input)
      : url.toString();
    const cacheKey = stableWallboardCacheKey(url);
    const cached = readStoredWallboardResponse(cacheKey);

    // The shared request helper uses short client-side abort timers. ETA and geofence
    // reconstruction can legitimately exceed those while RoadTech/Azure/Tacho are slow.
    // Do not abort an otherwise healthy server calculation; keep the last confirmed row
    // visible until this slower read completes and then atomically replace it.
    const resilientInit = init ? { ...init, signal: undefined, cache: "no-store" as RequestCache } : { cache: "no-store" as RequestCache };

    const refreshCacheInBackground = async () => {
      try {
        const response = await originalFetch(fetchInput, resilientInit);
        if (!response.ok) return;
        const clone = response.clone();
        const body = await clone.text();
        writeStoredWallboardResponse(cacheKey, response, body);
      } catch {
        // The visible wallboard continues to use the last confirmed snapshot.
      }
    };

    // A wallboard tab must open from the last confirmed snapshot immediately rather than
    // cold-loading Azure, tracking, geofence, ETA and Tacho feeds every time the user
    // returns to the tab. Refresh the same resource quietly behind the cached response;
    // the normal 20-second wallboard cycle will pick up the newer snapshot next pass.
    if (cached) {
      void refreshCacheInBackground();
      return responseFromCache(cached)!;
    }

    try {
      const response = await originalFetch(fetchInput, resilientInit);
      if (response.ok) {
        const clone = response.clone();
        void clone.text().then(body => writeStoredWallboardResponse(cacheKey, response, body)).catch(() => undefined);
        return response;
      }

      // Never hide a genuine pairing/authentication problem, but transient service,
      // timeout and throttling faults must not blank a live operations screen.
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        return responseFromCache(readStoredWallboardResponse(cacheKey)) || response;
      }
      return response;
    } catch (error) {
      return responseFromCache(readStoredWallboardResponse(cacheKey)) || Promise.reject(error);
    }
  };
}

installWallboardFetchResilience();

function FirstCollectionTimeLabel() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLElement>(".ops-board-row .time-cell:first-child small").forEach(label => {
        if (label.textContent?.trim().toLowerCase() === "planned start") label.textContent = "first collection";
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}

function CompletedExitEvidenceLabel() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLElement>(".ops-board-row.final-arrived .progress-cell").forEach(cell => {
        const markers = cell.querySelectorAll(".ops-progress-marker");
        const departed = cell.querySelectorAll(".ops-progress-marker.done");
        const existing = cell.querySelector<HTMLElement>(".ops-progress-exit-evidence");
        if (markers.length > 0 && departed.length === markers.length) {
          if (!existing) {
            const label = document.createElement("small");
            label.className = "ops-progress-exit-evidence";
            label.textContent = `${departed.length} of ${markers.length} geofences exited`;
            cell.appendChild(label);
          } else {
            existing.textContent = `${departed.length} of ${markers.length} geofences exited`;
          }
        } else {
          existing?.remove();
        }
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return null;
}

function WallboardStatusClarifier() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLElement>(".ops-board-row.onsite:not(.final-arrived)").forEach(row => {
        const status = row.querySelector<HTMLElement>(".status-cell strong");
        if (status?.textContent?.trim().toUpperCase() === "ARRIVED") status.textContent = "ON SITE";
      });

      document.querySelectorAll<HTMLElement>(".ops-wallboard-alert").forEach(alert => {
        const text = alert.textContent || "";
        if (/refresh is unavailable|snapshot is unavailable/i.test(text)) {
          alert.textContent = "Live refresh delayed — retaining the last confirmed ETA, progress, driver and vehicle data until a newer successful snapshot arrives.";
        }
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}

export function OperationsWallboard({ tvMode = false, tvAccessKey }: { tvMode?: boolean; tvAccessKey?: string }) {
  return <>
    <FirstCollectionTimeLabel />
    <CompletedExitEvidenceLabel />
    <WallboardStatusClarifier />
    <EtaLearningBridge />
    {!tvMode && <RunGeofenceLinkagePanel />}
    <ExistingOperationsWallboard tvMode={tvMode} tvAccessKey={tvAccessKey} />
  </>;
}
