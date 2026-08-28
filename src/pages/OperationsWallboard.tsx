import { useEffect } from "react";
import { OperationsWallboard as ExistingOperationsWallboard } from "./OperationsWallboardLive";
import { RunGeofenceLinkagePanel } from "./RunGeofenceLinkagePanel";
import { stableFinalEta } from "./stableFinalEta";
import "../run-geofence-linkage.css";

type EtaRecord = {
  loadId?: string;
  loadReference?: string;
  stopId?: string;
  sequence?: number;
  stopName?: string;
  orderReference?: string;
  customerCode?: string;
  etaUtc?: string;
  source?: string;
  deliveryWindowEndUtc?: string;
  risk?: string;
  isFinalDestination?: boolean;
  [key: string]: unknown;
};
type TimingRecord = {
  loadId: string;
  loadReference?: string;
  completed: boolean;
  finalEtaUtc?: string;
  finalEtaSource?: string;
  finalDestinationStopId?: string;
  finalDestinationName?: string;
};
type TimingResponse = { geofenceAvailable?: boolean; records?: TimingRecord[] };
type RouteStop = { id?: string; sequence?: number; name?: string; state?: string };
type RouteRecord = { loadId?: string; focusStop?: string; stops?: RouteStop[]; [key: string]: unknown };
type RouteResponse = { runs?: RouteRecord[]; [key: string]: unknown };

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
function isDeliveryDestination(eta: EtaRecord) {
  return /^deliver\b/i.test(String(eta.stopName || ""))
    || Boolean(eta.orderReference || eta.customerCode || eta.deliveryWindowEndUtc);
}
function cleanStopName(value?: string) {
  return String(value || "").replace(/^Collect\s*[·:-]?\s*|^Deliver\s*[·:-]?\s*/i, "").trim();
}
function routeWithFinalDestination(response: Response, payload: RouteResponse) {
  if (!Array.isArray(payload.runs)) return response;
  const runs = payload.runs.map(run => {
    const orderedStops = [...(run.stops || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const finalDelivery = [...orderedStops].reverse().find(stop => /^Deliver\b/i.test(String(stop.name || "")));
    const finalName = cleanStopName(finalDelivery?.name);
    const currentName = cleanStopName(run.focusStop);
    if (!finalName || !run.focusStop || currentName.toLowerCase() === finalName.toLowerCase()) return run;
    return { ...run, focusStop: `${run.focusStop} · Final: ${finalName}` };
  });
  return jsonResponse(response, { ...payload, runs });
}

/**
 * Run Progress wrapper. A run-timing final ETA exists only after authoritative execution
 * evidence (geofence departure/current visit or a valid live-route anchor), so it is safe
 * to override the CSV Deliver By time only when this feed provides one. Route progression
 * also keeps the current stop distinct from the final customer delivery, which is critical
 * for multi-drop and overnight continuation work.
 */
export function OperationsWallboard({ tvMode = false, tvAccessKey }: { tvMode?: boolean; tvAccessKey?: string }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const lastTiming = new Map<string, TimingRecord>();
    const acceptedFinalEtas = new Map<string, string>();

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = requestUrl(input);
      if (!response.ok) return response;

      if (url.includes("/api/v1/tv-display/route-progress")) {
        try {
          const payload = await response.clone().json() as RouteResponse;
          return routeWithFinalDestination(response, payload);
        } catch {
          return response;
        }
      }

      if (!url.includes("/api/v1/operations/delivery-etas")) return response;

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
          if (record.completed) {
            lastTiming.delete(record.loadId);
            acceptedFinalEtas.delete(record.loadId);
          } else {
            lastTiming.set(record.loadId, { ...lastTiming.get(record.loadId), ...record });
          }
        }

        const latestTiming = new Map<string, TimingRecord>();
        for (const record of timing?.records || []) latestTiming.set(record.loadId, record);

        // Legacy/staggered deployments may not yet expose finalDestinationStopId. In that
        // case choose the last customer delivery destination, not simply the highest stop
        // sequence (which may be a return/depot or other operational stop).
        const highestSequenceByLoad = new Map<string, number>();
        const destinationSequenceByLoad = new Map<string, number>();
        for (const eta of payload.records) {
          if (!eta.loadId || eta.sequence == null) continue;
          highestSequenceByLoad.set(eta.loadId, Math.max(highestSequenceByLoad.get(eta.loadId) ?? eta.sequence, eta.sequence));
          if (isDeliveryDestination(eta))
            destinationSequenceByLoad.set(eta.loadId, Math.max(destinationSequenceByLoad.get(eta.loadId) ?? eta.sequence, eta.sequence));
        }

        const records = payload.records.map(eta => {
          if (!eta.loadId) return eta;
          const authoritative = latestTiming.get(eta.loadId) || lastTiming.get(eta.loadId);
          const fallbackSequence = destinationSequenceByLoad.get(eta.loadId) ?? highestSequenceByLoad.get(eta.loadId);
          const finalDestination = authoritative?.finalDestinationStopId
            ? eta.stopId === authoritative.finalDestinationStopId
            : eta.sequence != null && eta.sequence === fallbackSequence;
          if (!finalDestination) return eta;

          if (!authoritative?.finalEtaUtc) return { ...eta, isFinalDestination: true };
          const acceptedEta = stableFinalEta(
            authoritative.finalEtaUtc,
            eta.etaUtc,
            eta.deliveryWindowEndUtc,
            acceptedFinalEtas.get(eta.loadId),
          );
          if (!acceptedEta) return { ...eta, isFinalDestination: true };
          acceptedFinalEtas.set(eta.loadId, acceptedEta);
          return {
            ...eta,
            isFinalDestination: true,
            etaUtc: acceptedEta,
            source: mappedEtaSource(authoritative.finalEtaSource) || eta.source,
            deliveryWindowEndUtc: eta.deliveryWindowEndUtc,
          };
        });

        // On a fresh wallboard load the final customer destination may already be complete
        // while a later return/depot leg is still active. The normal ETA feed then contains
        // only the remaining operational work. Preserve Run Timing's actual customer-arrival
        // evidence as a synthetic destination record so "final ETA" cannot jump to the return.
        for (const authoritative of latestTiming.values()) {
          if (authoritative.completed || !authoritative.finalDestinationStopId || !authoritative.finalEtaUtc) continue;
          if (records.some(eta => eta.loadId === authoritative.loadId && eta.stopId === authoritative.finalDestinationStopId)) continue;
          const highest = Math.max(0, ...records.filter(eta => eta.loadId === authoritative.loadId).map(eta => eta.sequence ?? 0));
          const acceptedEta = stableFinalEta(
            authoritative.finalEtaUtc,
            undefined,
            undefined,
            acceptedFinalEtas.get(authoritative.loadId),
          ) || authoritative.finalEtaUtc;
          acceptedFinalEtas.set(authoritative.loadId, acceptedEta);
          records.push({
            loadId: authoritative.loadId,
            loadReference: authoritative.loadReference,
            stopId: authoritative.finalDestinationStopId,
            sequence: highest + 1,
            stopName: authoritative.finalDestinationName || "Final destination",
            etaUtc: acceptedEta,
            source: mappedEtaSource(authoritative.finalEtaSource) || "Live",
            risk: "Pending",
            isFinalDestination: true,
            routeDrivingMinutes: 0,
            breakMinutesIncluded: 0,
            tachoStatus: "Unavailable",
            tachoExplanation: "Final customer destination timing retained from authoritative Run Timing evidence.",
          });
        }

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
    <ExistingOperationsWallboard tvMode={tvMode} tvAccessKey={tvAccessKey} />
  </>;
}
