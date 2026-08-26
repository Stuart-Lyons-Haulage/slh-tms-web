export type StopDwell = { stopId?: string; sequence?: number };
export type Visit = {
  loadStopId?: string;
  enteredAtUtc?: string;
  confirmedAtUtc?: string;
  isDelayed?: boolean;
  dwellMinutes?: number;
  liveDwellMinutes?: number;
  liveDwellSeconds?: number;
};
export type ProgressRecord = {
  loadId?: string;
  totalStops?: number;
  completedStops?: number;
  currentVisit?: Visit | null;
  stopDwell?: StopDwell[];
};
export type RouteRun = ProgressRecord & { stops?: Array<{ id?: string; sequence?: number }> };
export type EtaRecord = {
  loadId?: string;
  stopId?: string;
  sequence?: number;
  etaUtc?: string;
  source?: string;
  trackingUpdatedAtUtc?: string;
  risk?: string;
  [key: string]: unknown;
};
export type CachedEta = { record: EtaRecord; seenAt: number };

const ETA_RETENTION_MS = 5 * 60 * 1000;

function etaKey(record: EtaRecord) {
  return `${record.loadId || ""}|${record.stopId || ""}|${record.sequence ?? ""}`;
}

function hasUsefulEta(record?: EtaRecord) {
  if (!record?.etaUtc) return false;
  const source = String(record.source || "").toLowerCase();
  return source === "live" || source === "estimated" || source === "geofence" || source === "geofenceestimated";
}

export function isFinalCurrentVisit(record: ProgressRecord) {
  if (!record.currentVisit || !record.totalStops || record.totalStops <= 0) return false;
  const sequence = record.stopDwell?.find(stop => stop.stopId && stop.stopId === record.currentVisit?.loadStopId)?.sequence;
  if (sequence != null) return sequence === record.totalStops;
  return (record.completedStops ?? 0) === record.totalStops - 1;
}

export function normaliseFinalArrival<T extends ProgressRecord>(record: T): T {
  if (!isFinalCurrentVisit(record) || !record.currentVisit) return record;
  return {
    ...record,
    currentVisit: {
      ...record.currentVisit,
      isDelayed: false,
      confirmedAtUtc: undefined,
      dwellMinutes: 0,
      liveDwellMinutes: undefined,
      liveDwellSeconds: undefined,
    },
  } as T;
}

export function retainUsefulEtas(current: EtaRecord[], cache: Map<string, CachedEta>, activeLoadIds: Set<string>, now = Date.now()) {
  const next = current.map(record => {
    const key = etaKey(record);
    if (hasUsefulEta(record)) {
      cache.set(key, { record, seenAt: now });
      return record;
    }
    const cached = cache.get(key);
    if (!cached || now - cached.seenAt > ETA_RETENTION_MS || !record.loadId || !activeLoadIds.has(record.loadId)) return record;
    return {
      ...record,
      etaUtc: cached.record.etaUtc,
      source: cached.record.source,
      trackingUpdatedAtUtc: cached.record.trackingUpdatedAtUtc,
      risk: cached.record.risk ?? record.risk,
    };
  });

  const present = new Set(next.map(etaKey));
  for (const [key, cached] of cache) {
    if (now - cached.seenAt > ETA_RETENTION_MS) {
      cache.delete(key);
      continue;
    }
    const loadId = cached.record.loadId;
    if (!loadId || !activeLoadIds.has(loadId) || present.has(key)) continue;
    next.push(cached.record);
  }
  return next;
}
