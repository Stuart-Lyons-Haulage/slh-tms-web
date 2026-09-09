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

function combinedEtaSource(timingSource: DeliveryEta['source'] | undefined, deliverySource: DeliveryEta['source']) {
  if (timingSource === 'Estimated' || deliverySource === 'Estimated') return 'Estimated' as DeliveryEta['source'];
  if (timingSource === 'Live' || deliverySource === 'Live') return 'Live' as DeliveryEta['source'];
  return timingSource || deliverySource;
}

function cleanStopName(value?: string) {
  return String(value || '').replace(/^Collect\s*[·:-]?\s*|^Deliver\s*[·:-]?\s*/i, '').trim();
}

function isSyntheticTimingEta(eta: DeliveryEta) {
  return eta.stopId.startsWith('timing-final-') || eta.sequence === Number.MAX_SAFE_INTEGER;
}

function addMinutes(value: string, minutes: number) {
  if (!minutes) return value;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + minutes * 60_000).toISOString() : value;
}

function sameDestination(eta: DeliveryEta, authoritative: RunTimingRecord) {
  if (authoritative.finalDestinationStopId && eta.stopId === authoritative.finalDestinationStopId) return true;
  const etaName = cleanStopName(eta.stopName).toLowerCase();
  const authoritativeName = cleanStopName(authoritative.finalDestinationName).toLowerCase();
  return Boolean(etaName && authoritativeName && etaName === authoritativeName);
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
 * Build one authoritative customer ETA for every board.
 *
 * Run Timing contributes the live RoadTech/geofence route, current-site dwell and
 * remaining-stop sequence. Delivery ETA contributes the TachoMaster legal-break
 * calculation and customer delivery window. The same merged value is consumed by the
 * signed-in Operations wallboard and the paired TV wallboard.
 *
 * Synthetic timing rows are only a resilience fallback. When the canonical delivery ETA
 * exists they are removed so an older timing snapshot cannot replace a newer live ETA.
 * A canonical delivery row must retain its delivery window even when the API stop IDs differ;
 * otherwise a late final ETA could be displayed without being classified as late.
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

  const loadsWithCanonicalEta = new Set(
    incoming.filter(eta => !isSyntheticTimingEta(eta)).map(eta => eta.loadId),
  );
  const canonicalIncoming = incoming.filter(eta => !isSyntheticTimingEta(eta) || !loadsWithCanonicalEta.has(eta.loadId));

  const highestSequenceByLoad = new Map<string, number>();
  const destinationSequenceByLoad = new Map<string, number>();
  for (const eta of canonicalIncoming) {
    highestSequenceByLoad.set(eta.loadId, Math.max(highestSequenceByLoad.get(eta.loadId) ?? eta.sequence, eta.sequence));
    if (isDeliveryDestination(eta))
      destinationSequenceByLoad.set(eta.loadId, Math.max(destinationSequenceByLoad.get(eta.loadId) ?? eta.sequence, eta.sequence));
  }

  const records: EnrichedEta[] = canonicalIncoming.map(eta => {
    const authoritative = latestTiming.get(eta.loadId) || lastTiming.get(eta.loadId);
    const fallbackSequence = destinationSequenceByLoad.get(eta.loadId) ?? highestSequenceByLoad.get(eta.loadId);
    const finalDestination = authoritative
      ? sameDestination(eta, authoritative) || eta.sequence === fallbackSequence && isDeliveryDestination(eta)
      : eta.sequence === fallbackSequence;
    if (!finalDestination) return eta;
    if (!authoritative?.finalEtaUtc) return { ...eta, isFinalDestination: true };

    const timingSource = mappedEtaSource(authoritative.finalEtaSource);
    const timingMs = Date.parse(authoritative.finalEtaUtc);
    const futurePrediction = Number.isFinite(timingMs) && timingMs > Date.now() + 30_000;
    const legalBreakMinutes = futurePrediction ? Math.max(0, Number(eta.breakMinutesIncluded || 0)) : 0;
    const combinedCandidate = addMinutes(authoritative.finalEtaUtc, legalBreakMinutes);

    const acceptedEta = stableFinalEta(
      combinedCandidate,
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
      source: combinedEtaSource(timingSource, eta.source),
    };
  });

  for (const authoritative of latestTiming.values()) {
    if (authoritative.completed || !authoritative.finalEtaUtc) continue;

    const sameLoad = records.filter(eta => eta.loadId === authoritative.loadId);
    const canonicalDelivery = [...sameLoad]
      .sort((a, b) => b.sequence - a.sequence)
      .find(isDeliveryDestination);

    // If a canonical delivery record exists, keep its customer window/risk metadata and
    // never append a second timing-only final row. Stop IDs can legitimately differ after
    // plan/import reconciliation, so name/sequence matching above is deliberately tolerant.
    if (canonicalDelivery) continue;
    if (!authoritative.finalDestinationStopId) continue;
    if (records.some(eta => eta.loadId === authoritative.loadId && sameDestination(eta, authoritative))) continue;

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
