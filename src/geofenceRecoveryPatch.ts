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

function isGeofenceStatusRequest(url: string) {
  return url.includes('/api/v1/run-progress') ||
    url.includes('/api/v1/geofence-integrity') ||
    /\/api\/v1\/geofences(?:\?|$)/.test(url);
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await originalFetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!isGeofenceStatusRequest(url)) return response;

  let needsRecovery = !response.ok;
  if (response.ok) {
    try {
      const payload = await response.clone().json() as {
        geofenceAvailable?: boolean;
        engineReady?: boolean;
        count?: number;
        records?: unknown[];
      };
      if (url.includes('/api/v1/run-progress')) needsRecovery = payload.geofenceAvailable === false;
      else if (url.includes('/api/v1/geofence-integrity')) needsRecovery = payload.engineReady === false;
      else needsRecovery = payload.count === 0 || Array.isArray(payload.records) && payload.records.length === 0;
    } catch {
      return response;
    }
  }

  if (!needsRecovery) return response;

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const recovered = await recover(headers);
  if (!recovered) return response;

  return originalFetch(input, init);
};
