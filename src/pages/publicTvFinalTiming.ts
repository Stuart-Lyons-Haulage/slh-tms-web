export type TvTimingRecord = {
  loadId: string;
  completed: boolean;
  finalEtaUtc?: string;
  finalEtaSource?: string;
};

export type TvTimingResponse = {
  planningDate: string;
  geofenceAvailable: boolean;
  records: TvTimingRecord[];
};

type TvTimingRun = {
  id: string;
  finalStop?: string;
  etaTarget?: string;
  etaUtc?: string;
  etaSource: string;
  state: string;
  [key: string]: unknown;
};

function displayEtaSource(source?: string) {
  if (source === "Geofence") return "Live";
  if (source === "GeofenceEstimated") return "Estimated";
  return source;
}

export function mergeAuthoritativeFinalTiming<T extends TvTimingRun>(runs: T[], timing?: TvTimingResponse): T[] {
  if (!timing?.geofenceAvailable || !Array.isArray(timing.records)) return runs;
  const byLoad = new Map(timing.records.map(record => [record.loadId, record]));

  return runs.map(run => {
    if (run.state === "ARRIVED" || run.etaSource === "Arrived") return run;
    const record = byLoad.get(run.id);
    if (!record || record.completed || !record.finalEtaUtc) return run;
    return {
      ...run,
      etaUtc: record.finalEtaUtc,
      etaSource: displayEtaSource(record.finalEtaSource) || run.etaSource,
      etaTarget: run.finalStop || run.etaTarget,
    };
  });
}
