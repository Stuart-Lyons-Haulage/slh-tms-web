export {};

const originalFetch = window.fetch.bind(window);
let recoveryPromise: Promise<boolean> | null = null;

async function recover(headers: Headers): Promise<boolean> {
  if (!headers.has('Authorization')) return false;
  if (recoveryPromise) return recoveryPromise;

  recoveryPromise = (async () => {
    try {
      const response = await originalFetch('/tms-api/api/v1/geofence-recovery/ensure', {
        method: 'POST',
        headers,
        cache: 'no-store',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      window.setTimeout(() => { recoveryPromise = null; }, 15_000);
    }
  })();

  return recoveryPromise;
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await originalFetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (!response.ok || !url.includes('/api/v1/run-progress')) return response;

  let payload: { geofenceAvailable?: boolean } | null = null;
  try { payload = await response.clone().json(); } catch { return response; }
  if (payload?.geofenceAvailable !== false) return response;

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const recovered = await recover(headers);
  if (!recovered) return response;

  return originalFetch(input, init);
};
