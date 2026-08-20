export {};

const wallboardPaths = new Set([
  '/tv',
  '/operations-wallboard',
  '/operations-wallboard/tv',
  '/live-runs',
  '/live-runs/tv',
]);

const wallboardActive = wallboardPaths.has(window.location.pathname);

if (wallboardActive) {
  const nativeFetch = window.fetch.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);

  type CachedResponse = {
    storedAt: number;
    status: number;
    statusText: string;
    headers: [string, string][];
    body: string;
  };

  const cache = new Map<string, CachedResponse>();
  const inFlight = new Map<string, Promise<CachedResponse>>();
  const maxStaleMs = 10 * 60_000;

  function urlOf(input: RequestInfo | URL) {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return new URL(raw, window.location.origin);
  }

  function cachePolicy(url: URL) {
    const path = url.pathname;
    if (path.includes('/api/v1/operations/delivery-etas') || path.includes('/api/v1/run-progress')) {
      return 60_000;
    }
    if (path.includes('/api/v1/loads') || path.includes('/api/v1/driver-assignments')) {
      return 5 * 60_000;
    }
    return 0;
  }

  function responseFrom(entry: CachedResponse) {
    return new Response(entry.body, {
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers,
    });
  }

  async function fetchAndStore(input: RequestInfo | URL, init: RequestInit | undefined, key: string) {
    const response = await nativeFetch(input, init);
    if (!response.ok) throw response;
    const body = await response.clone().text();
    const entry: CachedResponse = {
      storedAt: Date.now(),
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body,
    };
    cache.set(key, entry);
    return entry;
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return nativeFetch(input, init);

    const url = urlOf(input);
    const ttl = cachePolicy(url);
    if (ttl <= 0) return nativeFetch(input, init);

    const key = `${method}:${url.toString()}`;
    const existing = cache.get(key);
    const age = existing ? Date.now() - existing.storedAt : Number.POSITIVE_INFINITY;

    if (existing && age < ttl) return responseFrom(existing);

    let pending = inFlight.get(key);
    if (!pending) {
      pending = fetchAndStore(input, init, key).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }

    try {
      return responseFrom(await pending);
    } catch (error) {
      if (existing && age < maxStaleMs) {
        console.warn('Wallboard refresh failed; retaining last confirmed snapshot.', url.pathname, error);
        return responseFrom(existing);
      }
      if (error instanceof Response) return error;
      throw error;
    }
  };

  // OperationsWallboard currently owns a 20-second timer. Promote only that cadence
  // to one minute on wallboard routes; unrelated application timers keep their values.
  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const effectiveTimeout = timeout === 20_000 ? 60_000 : timeout;
    return nativeSetInterval(handler, effectiveTimeout, ...args);
  }) as typeof window.setInterval;
}
