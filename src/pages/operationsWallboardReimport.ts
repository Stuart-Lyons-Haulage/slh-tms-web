export type TimingRecord = {
  loadId: string;
  loadReference?: string;
  completed: boolean;
  nextStopId?: string;
  nextStopSequence?: number;
  nextEtaUtc?: string;
  etaSource?: string;
  finalEtaUtc?: string;
  finalEtaSource?: string;
};

export type LoadSnapshot = {
  id?: string;
  reference?: string;
  status?: string;
  stops?: Array<{ id?: string; sequence?: number; name?: string; plannedArrivalUtc?: string }>;
};

export type SyntheticEtaRecord = {
  loadId?: string;
  loadReference?: string;
  loadStatus?: string;
  stopId?: string;
  sequence?: number;
  stopName?: string;
  etaUtc?: string;
  source?: string;
  deliveryWindowEndUtc?: string;
  risk?: string;
  routeDrivingMinutes?: number;
  breakMinutesIncluded?: number;
  tachoStatus?: string;
  tachoExplanation?: string;
};

function mappedEtaSource(source?: string) {
  return source === 'Geofence' ? 'Live' : source === 'GeofenceEstimated' ? 'Estimated' : undefined;
}

/**
 * Reconstruct the next/final ETA rows from run-timing plus the canonical run stops
 * when an ETA refresh is temporarily sparse after reset or re-import. This is pure
 * data transformation: callers own the request lifecycle and no browser globals are mutated.
 */
export function syntheticTimingEtas(load: LoadSnapshot, anchor: TimingRecord): SyntheticEtaRecord[] {
  if (!load.id) return [];
  const stops = [...(load.stops || [])]
    .filter(stop => stop.id && stop.sequence != null)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
  if (!stops.length) return [];

  const next = stops.find(stop => Boolean(anchor.nextStopId && stop.id === anchor.nextStopId)
    || anchor.nextStopSequence != null && stop.sequence === anchor.nextStopSequence);
  const final = stops.at(-1);
  const selected = next && final && next.id !== final.id ? [next, final] : [final || next].filter(Boolean);

  return selected.map(stop => {
    const isNext = Boolean(anchor.nextStopId && stop?.id === anchor.nextStopId)
      || anchor.nextStopSequence != null && stop?.sequence === anchor.nextStopSequence;
    const isFinal = stop?.id === final?.id;
    const timingEta = isFinal ? anchor.finalEtaUtc : isNext ? anchor.nextEtaUtc : undefined;
    const timingSource = isFinal ? anchor.finalEtaSource : isNext ? anchor.etaSource : undefined;
    const planned = stop?.plannedArrivalUtc;
    return {
      loadId: load.id,
      loadReference: anchor.loadReference || load.reference,
      loadStatus: load.status || 'Planned',
      stopId: stop?.id,
      sequence: stop?.sequence,
      stopName: stop?.name || 'Planned stop',
      etaUtc: timingEta || planned,
      source: timingEta ? mappedEtaSource(timingSource) || 'Estimated' : planned ? 'Planned' : 'Unavailable',
      deliveryWindowEndUtc: isFinal ? planned : undefined,
      risk: 'Pending',
      routeDrivingMinutes: 0,
      breakMinutesIncluded: 0,
      tachoStatus: 'Unavailable',
      tachoExplanation: 'Run timing supplied the active ETA while the primary delivery ETA feed was temporarily sparse after reset or re-import.',
    };
  });
}
