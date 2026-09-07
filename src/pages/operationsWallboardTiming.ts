import type { DeliveryEta } from '../lib/api';
import { stableFinalEta } from './stableFinalEta';
import type { RouteProgressRun } from './operationsWallboardProgress';

export type RunTimingRecord = {
  loadId: string;
  loadReference?: string;
  completed: boolean;
  finalEtaUtc?: string;
  finalEtaSource?: string;
  finalDestinationStopId?: string;
  finalDestinationName?: string;
};

export type RunTimingResponse = {
  geofenceAvailable?: boolean;
  records?: RunTimingRecord[];
};

type EnrichedEta = DeliveryEta & { isFinalDestination?: boolean };

function isDeliveryDestination(eta: DeliveryEta) {
  return /^deliver\b/i.test(String(eta.stopName || ''))
    || Boolean(eta.orderReference || eta.customerCode || eta.deliveryWindowEndUtc);
}

function mappedEtaSource(source?: string): DeliveryEta['source'] | undefined {
  return source === 'Geofence' ? 'Live' : source === 'GeofenceEstimated' ? 'Estimated' : undefined;
}

function cleanStopName(value?: string) {
  return String(value || '').replace(/^Collect\s*[·:-]?\s*|^Deliver\s*[·:-]?\s*/i, '').trim();
}

/**
 * Keep the current operational focus and final customer destination distinct without
 * intercepting global fetch. This is the direct equivalent of the old route-progress patch.
 */
export function enrichRouteFinalDestination(runs: RouteProgressRun[]) {
  return runs.map(run => {
    const orderedStops = [...(run.stops || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const finalDelivery = [...orderedStops].reverse().find(stop => /^Deliver\b/i.test(String(stop.name || '')));
    const finalName = cleanStopName(finalDelivery?.name);
    const currentName = cleanStopName(run.focusStop);
    if (!finalName || !run.focusStop || currentName.toLowerCase() === finalName.toLowerCase()) return run;
    return { ...run, focusStop: `${run.focusStop} · Final: ${finalName}` };
  });
}

/**
 * Merge authoritative Run Timing evidence into delivery ETAs. Completed customer delivery
 * evidence is retained even when a later return/depot leg remains active. State is explicit
 * and component-owned; no Response/global-fetch mutation is used.
 */
export function mergeWallboardTiming(
  incoming: DeliveryEta[],
  timingRecords: RunTimingRecord[],
  lastTiming: Map<string, RunTimingRecord>,
  acceptedFinalEtas: Map<string, string>,
): DeliveryEta[] {
  for (const record of timingRecords) {
    if (record.completed) {
      lastTiming.delete(record.loadId);
      acceptedFinalEtas.delete(record.loadId);
    } else {
      lastTiming.set(record.loadId, { ...lastTiming.get(record.loadId), ...record });
    }
  }

  const latestTiming = new Map<string, RunTimingRecord>();
  for (const record of timingRecords) latestTiming.set(record.loadId, record);

  const highestSequenceByLoad = new Map<string, number>();
  const destinationSequenceByLoad = new Map<string, number>();
  for (const eta of incoming) {
    highestSequenceByLoad.set(eta.loadId, Math.max(highestSequenceByLoad.get(eta.loadId) ?? eta.sequence, eta.sequence));
    if (isDeliveryDestination(eta))
      destinationSequenceByLoad.set(eta.loadId, Math.max(destinationSequenceByLoad.get(eta.loadId) ?? eta.sequence, eta.sequence));
  }

  const records: EnrichedEta[] = incoming.map(eta => {
    const authoritative = latestTiming.get(eta.loadId) || lastTiming.get(eta.loadId);
    const fallbackSequence = destinationSequenceByLoad.get(eta.loadId) ?? highestSequenceByLoad.get(eta.loadId);
    const finalDestination = authoritative?.finalDestinationStopId
      ? eta.stopId === authoritative.finalDestinationStopId
      : eta.sequence === fallbackSequence;
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
    };
  });

  for (const authoritative of latestTiming.values()) {
    if (authoritative.completed || !authoritative.finalDestinationStopId || !authoritative.finalEtaUtc) continue;
    if (records.some(eta => eta.loadId === authoritative.loadId && eta.stopId === authoritative.finalDestinationStopId)) continue;

    const sameLoad = records.filter(eta => eta.loadId === authoritative.loadId);
    const template = sameLoad[0];
    if (!template) continue;
    const highest = Math.max(0, ...sameLoad.map(eta => eta.sequence));
    const acceptedEta = stableFinalEta(
      authoritative.finalEtaUtc,
      undefined,
      undefined,
      acceptedFinalEtas.get(authoritative.loadId),
    ) || authoritative.finalEtaUtc;
    acceptedFinalEtas.set(authoritative.loadId, acceptedEta);
    records.push({
      ...template,
      loadReference: authoritative.loadReference || template.loadReference,
      stopId: authoritative.finalDestinationStopId,
      sequence: highest + 1,
      stopName: authoritative.finalDestinationName || 'Final destination',
      orderReference: undefined,
      customerCode: undefined,
      etaUtc: acceptedEta,
      source: mappedEtaSource(authoritative.finalEtaSource) || 'Live',
      deliveryWindowStartUtc: undefined,
      deliveryWindowEndUtc: undefined,
      risk: 'Pending',
      isFinalDestination: true,
    });
  }

  return records;
}
