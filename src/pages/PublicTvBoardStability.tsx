import { useEffect } from "react";
import { PublicTvBoard } from "./PublicTvBoard";
import { mergeAuthoritativeFinalTiming, retainLastUsefulTvEtas, type TvTimingResponse } from "./publicTvFinalTiming";

type TvRun = {
  id: string;
  finalStop?: string;
  etaTarget?: string;
  etaUtc?: string;
  etaSource: string;
  state: string;
  [key: string]: unknown;
};
type TvFeed = { planningDate?: string; runs?: TvRun[]; [key: string]: unknown };

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
}

function timingUrl(sourceUrl: string) {
  const parsed = new URL(sourceUrl, window.location.origin);
  const date = parsed.searchParams.get("date");
  const apiIndex = parsed.pathname.indexOf("/api/v1/");
  const prefix = apiIndex >= 0 ? parsed.pathname.slice(0, apiIndex) : "";
  return `${prefix}/api/v1/run-timing${date ? `?date=${encodeURIComponent(date)}` : ""}`;
}

function jsonResponse(original: Response, payload: unknown) {
  const headers = new Headers(original.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  return new Response(JSON.stringify(payload), { status: original.status, statusText: original.statusText, headers });
}

/** Keeps the public TV on the cumulative run-timing ETA once genuine geofence/live-route evidence exists. */
export function PublicTvBoardStability() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let previousRuns: TvRun[] = [];

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = requestUrl(input);
      if (!response.ok || !url.includes("/api/v1/tv-display/live-runs")) return response;

      try {
        const feed = await response.clone().json() as TvFeed;
        if (!Array.isArray(feed.runs)) return response;

        const timing = await originalFetch(timingUrl(url), {
          method: "GET",
          headers: requestHeaders(input, init),
          cache: "no-store",
        }).then(async timingResponse => timingResponse.ok ? await timingResponse.json() as TvTimingResponse : undefined)
          .catch(() => undefined);

        const authoritative = mergeAuthoritativeFinalTiming(feed.runs, timing);
        const stable = retainLastUsefulTvEtas(authoritative, previousRuns);
        previousRuns = stable;
        return jsonResponse(response, { ...feed, runs: stable });
      } catch {
        return response;
      }
    };

    window.fetch = patchedFetch;
    return () => { if (window.fetch === patchedFetch) window.fetch = originalFetch; };
  }, []);

  return <PublicTvBoard />;
}
