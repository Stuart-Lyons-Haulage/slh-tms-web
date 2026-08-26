import { useEffect, useState } from "react";
import { PublicTvBoard as ExistingPublicTvBoard } from "./PublicTvBoard";
import { stabiliseTvRuns, type CachedRun, type TvRun } from "./publicTvBoardStabilityLogic";

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
