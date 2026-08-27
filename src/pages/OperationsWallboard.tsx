import { useEffect } from "react";
import { OperationsWallboard as ExistingOperationsWallboard } from "./OperationsWallboardLive";
import { RunGeofenceLinkagePanel } from "./RunGeofenceLinkagePanel";
import "../run-geofence-linkage.css";

type EtaRecord = {
  loadId?: string;
  sequence?: number;
  etaUtc?: string;
  source?: string;
  deliveryWindowEndUtc?: string;
  [key: string]: unknown;
};
type TimingRecord = {
  loadId: string;
  completed: boolean;
  finalEtaUtc?: string;
  finalEtaSource?: string;
};
type TimingResponse = { geofenceAvailable?: boolean; records?: TimingRecord[] };

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
function mappedEtaSource(source?: string) {
  return source === "Geofence" ? "Live" : source === "GeofenceEstimated" ? "Estimated" : undefined;
}
function jsonResponse(original: Response, payload: unknown) {
  const headers = new Headers(original.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  return new Response(JSON.stringify(payload), { status: original.status, statusText: original.statusText, headers });
}

/**
 * Run Progress wrapper. A run-timing final ETA exists only after authoritative execution
 * evidence (geofence departure/current visit or a valid live-route anchor), so it is safe
 * to override the CSV Deliver By time only when this feed provides one.
 */
export function OperationsWallboard({ tvMode = false }: { tvMode?: boolean }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const lastTiming = new Map<string, TimingRecord>();

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = requestUrl(input);
      if (!response.ok || !url.includes("/api/v1/operations/delivery-etas")) return response;

      try {
        const payload = await response.clone().json() as { records?: EtaRecord[]; [key: string]: unknown };
        if (!Array.isArray(payload.records)) return response;

        const timing = await originalFetch(timingUrl(url), {
          method: "GET",
          headers: requestHeaders(input, init),
          cache: "no-store",
        }).then(async timingResponse => timingResponse.ok ? await timingResponse.json() as TimingResponse : undefined)
          .catch(() => undefined);

        for (const record of timing?.records || []) {
          if (record.completed) lastTiming.delete(record.loadId);
          else if (record.finalEtaUtc) lastTiming.set(record.loadId, record);
        }

        const finalSequenceByLoad = new Map<string, number>();
        for (const eta of payload.records) {
          if (!eta.loadId || eta.sequence == null) continue;
          finalSequenceByLoad.set(eta.loadId, Math.max(finalSequenceByLoad.get(eta.loadId) ?? eta.sequence, eta.sequence));
        }

        const records = payload.records.map(eta => {
          if (!eta.loadId || eta.sequence == null || eta.sequence !== finalSequenceByLoad.get(eta.loadId)) return eta;
          const authoritative = (timing?.records || []).find(record => record.loadId === eta.loadId && !record.completed && record.finalEtaUtc)
            || lastTiming.get(eta.loadId);
          if (!authoritative?.finalEtaUtc) return eta;
          return {
            ...eta,
            etaUtc: authoritative.finalEtaUtc,
            source: mappedEtaSource(authoritative.finalEtaSource) || eta.source,
            deliveryWindowEndUtc: eta.deliveryWindowEndUtc,
          };
        });

        return jsonResponse(response, { ...payload, records });
      } catch {
        return response;
      }
    };

    window.fetch = patchedFetch;
    return () => { if (window.fetch === patchedFetch) window.fetch = originalFetch; };
  }, []);

  return <>
    {!tvMode && <RunGeofenceLinkagePanel />}
    <ExistingOperationsWallboard tvMode={tvMode} />
  </>;
}
