export {};

const wallboardPaths = new Set([
  '/tv',
  '/operations-wallboard',
  '/operations-wallboard/tv',
  '/live-runs',
  '/live-runs/tv',
]);

if (wallboardPaths.has(window.location.pathname)) {
  const nativeFetch = window.fetch.bind(window);
  const carryoverEvidenceTtlMs = 60_000;
  const carryoverTrackingFreshnessMs = 15 * 60_000;

  type CarryoverLoad = { id: string; status?: string };
  type CarryoverEta = {
    loadId: string;
    stopId: string;
    source?: string;
    trackingUpdatedAtUtc?: string;
  };
  type CarryoverProgress = {
    loadId: string;
    runState?: string;
    completedStops?: number;
    totalStops?: number;
    currentVisit?: unknown;
  };
  type CarryoverEvidence = {
    date: string;
    storedAt: number;
    loads: CarryoverLoad[];
    etas: CarryoverEta[];
    progress: CarryoverProgress[];
    activeLoadIds: Set<string>;
  };

  let evidenceCache: CarryoverEvidence | undefined;
  let evidencePromise: Promise<CarryoverEvidence | undefined> | undefined;

  function ukIsoDate() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function previousIsoDate(value: string) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  function urlOf(input: RequestInfo | URL) {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return new URL(raw, window.location.origin);
  }

  function siblingApiUrl(source: URL, endpoint: string, date: string) {
    const apiIndex = source.pathname.indexOf('/api/v1/');
    if (apiIndex < 0) return undefined;
    const prefix = source.pathname.slice(0, apiIndex);
    const sibling = new URL(source.origin);
    sibling.pathname = `${prefix}/api/v1/${endpoint}`;
    sibling.searchParams.set('date', date);
    return sibling;
  }

  function jsonResponse(payload: unknown, source: Response) {
    const headers = new Headers(source.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(payload), {
      status: source.status,
      statusText: source.statusText,
      headers,
    });
  }

  function mergeBy<T>(older: T[], current: T[], key: (item: T) => string) {
    const merged = new Map<string, T>();
    for (const item of older) merged.set(key(item), item);
    for (const item of current) merged.set(key(item), item);
    return [...merged.values()];
  }

  function warningText(...values: Array<string | undefined>) {
    return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].join(' ');
  }

  function isFreshTracking(value?: string) {
    if (!value) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && Date.now() - timestamp <= carryoverTrackingFreshnessMs;
  }

  function statusShowsExecution(status?: string) {
    return /dispatched|in\s*transit|on\s*route|started|active|loading/i.test(String(status || ''));
  }

  function progressShowsExecution(progress: CarryoverProgress) {
    if (progress.currentVisit) return true;
    if ((progress.completedStops || 0) > 0) return true;
    return /between\s*stops|arrived|on\s*site|site\s*delay/i.test(String(progress.runState || ''));
  }

  async function loadCarryoverEvidence(sourceUrl: URL, init?: RequestInit): Promise<CarryoverEvidence | undefined> {
    const today = ukIsoDate();
    const previous = previousIsoDate(today);
    if (evidenceCache && evidenceCache.date === previous && Date.now() - evidenceCache.storedAt < carryoverEvidenceTtlMs) {
      return evidenceCache;
    }
    if (evidencePromise) return evidencePromise;

    evidencePromise = (async () => {
      try {
        const previousLoadsUrl = new URL(sourceUrl.toString());
        previousLoadsUrl.pathname = previousLoadsUrl.pathname.replace(/\/api\/v1\/.*$/, '/api/v1/loads');
        previousLoadsUrl.search = '';
        previousLoadsUrl.searchParams.set('date', previous);
        const etaUrl = siblingApiUrl(sourceUrl, 'operations/delivery-etas', previous);
        const progressUrl = siblingApiUrl(sourceUrl, 'run-progress', previous);
        if (!etaUrl || !progressUrl) return undefined;

        const [loadsResponse, etaResponse, progressResponse] = await Promise.all([
          nativeFetch(previousLoadsUrl.toString(), init),
          nativeFetch(etaUrl.toString(), init),
          nativeFetch(progressUrl.toString(), init),
        ]);
        if (!loadsResponse.ok) return undefined;

        const loads = await loadsResponse.clone().json() as CarryoverLoad[];
        const etaEnvelope = etaResponse.ok
          ? await etaResponse.clone().json() as { records?: CarryoverEta[] }
          : { records: [] as CarryoverEta[] };
        const progressEnvelope = progressResponse.ok
          ? await progressResponse.clone().json() as { records?: CarryoverProgress[] }
          : { records: [] as CarryoverProgress[] };
        const etas = etaEnvelope.records || [];
        const progress = progressEnvelope.records || [];

        const activeLoadIds = new Set<string>();
        for (const load of loads) {
          if (!['Completed', 'Cancelled'].includes(String(load.status)) && statusShowsExecution(load.status)) {
            activeLoadIds.add(load.id);
          }
        }
        for (const item of progress) {
          if (String(item.runState) === 'Completed' || ((item.totalStops || 0) > 0 && (item.completedStops || 0) >= (item.totalStops || 0))) {
            activeLoadIds.delete(item.loadId);
          } else if (progressShowsExecution(item)) {
            activeLoadIds.add(item.loadId);
          }
        }
        for (const eta of etas) {
          if (isFreshTracking(eta.trackingUpdatedAtUtc)) activeLoadIds.add(eta.loadId);
        }

        const evidence: CarryoverEvidence = {
          date: previous,
          storedAt: Date.now(),
          loads,
          etas,
          progress,
          activeLoadIds,
        };
        evidenceCache = evidence;
        return evidence;
      } catch (error) {
        console.warn('Could not verify overnight carry-over evidence; showing today only.', error);
        return evidenceCache?.date === previous ? evidenceCache : undefined;
      } finally {
        evidencePromise = undefined;
      }
    })();

    return evidencePromise;
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return nativeFetch(input, init);

    const url = urlOf(input);
    const today = ukIsoDate();
    const previous = previousIsoDate(today);
    const path = url.pathname;

    // Driver/vehicle allocations are relatively static. Ask once for the two-day
    // range so an overnight assignment remains attached to a verified carry-over run.
    if (path.includes('/api/v1/driver-assignments') &&
        url.searchParams.get('from') === today &&
        url.searchParams.get('to') === today) {
      const extended = new URL(url.toString());
      extended.searchParams.set('from', previous);
      extended.searchParams.set('to', today);
      return nativeFetch(extended.toString(), init);
    }

    const requestedDate = url.searchParams.get('date');
    if (requestedDate !== today) return nativeFetch(input, init);

    if (path.includes('/api/v1/loads')) {
      const [currentResponse, evidence] = await Promise.all([
        nativeFetch(input, init),
        loadCarryoverEvidence(url, init),
      ]);
      if (!currentResponse.ok || !evidence) return currentResponse;

      const current = await currentResponse.clone().json() as CarryoverLoad[];
      const carryover = evidence.loads.filter((load) => evidence.activeLoadIds.has(load.id));
      return jsonResponse(mergeBy(carryover, current, (item) => item.id), currentResponse);
    }

    if (path.includes('/api/v1/operations/delivery-etas')) {
      const [currentResponse, evidence] = await Promise.all([
        nativeFetch(input, init),
        loadCarryoverEvidence(url, init),
      ]);
      if (!currentResponse.ok || !evidence) return currentResponse;

      const current = await currentResponse.clone().json() as {
        planningDate: string;
        calculatedAtUtc: string;
        records: CarryoverEta[];
      };
      const carryover = evidence.etas.filter((item) => evidence.activeLoadIds.has(item.loadId));
      return jsonResponse({
        ...current,
        carryoverPlanningDate: evidence.activeLoadIds.size > 0 ? previous : undefined,
        records: mergeBy(carryover, current.records || [], (item) => `${item.loadId}:${item.stopId}`),
      }, currentResponse);
    }

    if (path.includes('/api/v1/run-progress')) {
      const [currentResponse, evidence] = await Promise.all([
        nativeFetch(input, init),
        loadCarryoverEvidence(url, init),
      ]);
      if (!currentResponse.ok || !evidence) return currentResponse;

      const current = await currentResponse.clone().json() as {
        planningDate: string;
        calculatedAtUtc: string;
        geofenceAvailable?: boolean;
        geofenceCount?: number;
        geofenceVisitCount?: number;
        geofenceLinkedRuns?: number;
        trackingEventCount?: number;
        latestTrackingUtc?: string;
        warning?: string;
        records: CarryoverProgress[];
      };
      const carryover = evidence.progress.filter((item) => evidence.activeLoadIds.has(item.loadId));
      return jsonResponse({
        ...current,
        carryoverPlanningDate: evidence.activeLoadIds.size > 0 ? previous : undefined,
        warning: warningText(current.warning),
        records: mergeBy(carryover, current.records || [], (item) => item.loadId),
      }, currentResponse);
    }

    return nativeFetch(input, init);
  };
}
