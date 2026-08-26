export {};

const originalFetch = window.fetch.bind(window);
const RECOVERY_COOLDOWN_MS = 5 * 60_000;
let recoveryPromise: Promise<boolean> | null = null;
let lastRecoveryAttemptAt = 0;

async function recover(headers: Headers): Promise<boolean> {
  if (!headers.has('Authorization')) return false;
  if (recoveryPromise) return recoveryPromise;
  if (Date.now() - lastRecoveryAttemptAt < RECOVERY_COOLDOWN_MS) return false;

  lastRecoveryAttemptAt = Date.now();
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
      recoveryPromise = null;
    }
  })();

  return recoveryPromise;
}

function isGeofenceRecoveryCandidate(url: string) {
  // Geofence Integrity already performs the authoritative embedded calculation.
  // Do not respond to a degraded integrity result by immediately running the same
  // expensive build again and then retrying it a third time. Live-run/geofence
  // feeds retain guarded recovery, with a five-minute circuit breaker.
  return url.includes('/api/v1/run-progress') ||
    /\/api\/v1\/geofences(?:\?|$)/.test(url);
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await originalFetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!isGeofenceRecoveryCandidate(url)) return response;

  let needsRecovery = !response.ok;
  if (response.ok) {
    try {
      const payload = await response.clone().json() as {
        geofenceAvailable?: boolean;
        count?: number;
        records?: unknown[];
      };
      if (url.includes('/api/v1/run-progress')) needsRecovery = payload.geofenceAvailable === false;
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
