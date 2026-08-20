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

  function latestIso(left?: string, right?: string) {
    if (!left) return right;
    if (!right) return left;
    return Date.parse(left) >= Date.parse(right) ? left : right;
  }

  function warningText(...values: Array<string | undefined>) {
    return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].join(' ');
  }

  async function fetchPrevious(url: URL, init?: RequestInit) {
    const previous = new URL(url.toString());
    previous.searchParams.set('date', previousIsoDate(ukIsoDate()));
    return nativeFetch(previous.toString(), init);
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return nativeFetch(input, init);

    const url = urlOf(input);
    const today = ukIsoDate();
    const previous = previousIsoDate(today);
    const path = url.pathname;

    // Driver/vehicle allocations are relatively static. Ask once for the two-day
    // range so an overnight assignment remains attached after the UK date rolls.
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
      const [currentResponse, previousResponse] = await Promise.all([
        nativeFetch(input, init),
        fetchPrevious(url, init),
      ]);
      if (!currentResponse.ok || !previousResponse.ok) return currentResponse;

      const current = await currentResponse.clone().json() as Array<{ id: string; status?: string }>;
      const older = await previousResponse.clone().json() as Array<{ id: string; status?: string }>;
      const carryover = older.filter((load) => !['Completed', 'Cancelled'].includes(String(load.status)));
      return jsonResponse(mergeBy(carryover, current, (item) => item.id), currentResponse);
    }

    if (path.includes('/api/v1/operations/delivery-etas')) {
      const [currentResponse, previousResponse] = await Promise.all([
        nativeFetch(input, init),
        fetchPrevious(url, init),
      ]);
      if (!currentResponse.ok || !previousResponse.ok) return currentResponse;

      const current = await currentResponse.clone().json() as {
        planningDate: string;
        calculatedAtUtc: string;
        records: Array<{ loadId: string; stopId: string }>;
      };
      const older = await previousResponse.clone().json() as typeof current;
      return jsonResponse({
        ...current,
        carryoverPlanningDate: previous,
        records: mergeBy(older.records || [], current.records || [], (item) => `${item.loadId}:${item.stopId}`),
      }, currentResponse);
    }

    if (path.includes('/api/v1/run-progress')) {
      const [currentResponse, previousResponse] = await Promise.all([
        nativeFetch(input, init),
        fetchPrevious(url, init),
      ]);
      if (!currentResponse.ok || !previousResponse.ok) return currentResponse;

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
        records: Array<{ loadId: string; runState?: string }>;
      };
      const older = await previousResponse.clone().json() as typeof current;
      return jsonResponse({
        ...current,
        carryoverPlanningDate: previous,
        geofenceAvailable: current.geofenceAvailable !== false || older.geofenceAvailable !== false,
        geofenceCount: Math.max(current.geofenceCount || 0, older.geofenceCount || 0),
        geofenceVisitCount: (current.geofenceVisitCount || 0) + (older.geofenceVisitCount || 0),
        geofenceLinkedRuns: (current.geofenceLinkedRuns || 0) + (older.geofenceLinkedRuns || 0),
        trackingEventCount: (current.trackingEventCount || 0) + (older.trackingEventCount || 0),
        latestTrackingUtc: latestIso(current.latestTrackingUtc, older.latestTrackingUtc),
        warning: warningText(current.warning, older.warning),
        records: mergeBy(older.records || [], current.records || [], (item) => item.loadId),
      }, currentResponse);
    }

    return nativeFetch(input, init);
  };
}
