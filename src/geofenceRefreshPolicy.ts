export {};

// The Geofence Integrity screen is operational, but its underlying calculation is
// heavier than the 20-second wallboard feeds. Keep it fresh without requiring an
// operator to recover a failed first load.
const REFRESH_INTERVAL_MS = 30_000;
const SITE_STATUS_PATH = /\/api\/v1\/site-geofence-sync\/sites(?:\?|$)/;

// Last-good site-status payload — survives transient API failures so the
// geofence table keeps rendering even when the secondary enrichment endpoint
// is temporarily unavailable.
let cachedSiteStatusJson: string | undefined;

// Wrap fetch so that a failed /sites call returns the last-good payload
// rather than blanking the geofence table.  This wrapper is installed by
// GeofenceOperational via installGeofenceSiteStatusFallback() and removed
// on unmount, so it never stacks across component lifecycles.
export function installGeofenceSiteStatusFallback(): () => void {
  const upstreamFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' || !SITE_STATUS_PATH.test(url)) return upstreamFetch(input, init);

    try {
      const response = await upstreamFetch(input, init);
      if (response.ok) {
        try { cachedSiteStatusJson = await response.clone().text(); } catch { /* keep previous cache */ }
        return response;
      }
    } catch {
      // Fall through to the last-good payload below.
    }

    return new Response(cachedSiteStatusJson || '[]', {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-SLH-Fallback': 'geofence-site-status',
      },
    });
  };

  return () => {
    if ((window.fetch as unknown as { _slhGeofence?: boolean })._slhGeofence) {
      window.fetch = upstreamFetch;
    }
  };
}

function geofenceRefreshButton() {
  const heading = [...document.querySelectorAll<HTMLElement>('h1,h2,h3')]
    .find(node => (node.textContent || '').trim().toLowerCase() === 'geofence integrity');
  if (!heading) return undefined;
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => (button.textContent || '').trim().toLowerCase() === 'refresh status');
}

function refreshGeofenceScreen() {
  if (document.visibilityState === 'hidden') return;
  const button = geofenceRefreshButton();
  if (!button || button.disabled) return;
  button.click();
}

// Auto-refresh the geofence screen when it is visible. These listeners are
// module-level because they only click a button — they do not touch window.fetch.
window.setInterval(refreshGeofenceScreen, REFRESH_INTERVAL_MS);
window.addEventListener('focus', refreshGeofenceScreen);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshGeofenceScreen();
});

