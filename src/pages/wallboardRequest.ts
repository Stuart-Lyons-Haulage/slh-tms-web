import { ApiError, request } from "../lib/api";

type CacheEntry = { value: unknown; storedAt: number };

const responseCache = new Map<string, CacheEntry>();
const MAX_CACHE_AGE_MS = 6 * 60 * 60 * 1000;

function withQuery(path: string, name: string, value: string) {
  const separator = path.includes("?") ? "&" : "?";
  if (new RegExp(`(?:^|[?&])${name}=`).test(path)) return path;
  return `${path}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}

function tvPath(path: string, displayKey?: string) {
  if (!displayKey) return path;
  let next = path;
  if (path.startsWith("/api/v1/operations/delivery-etas")) {
    next = path.replace("/api/v1/operations/delivery-etas", "/api/v1/tv-display/wallboard-proxy/delivery-etas");
  } else if (path.startsWith("/api/v1/run-progress")) {
    next = path.replace("/api/v1/run-progress", "/api/v1/tv-display/wallboard-proxy/run-progress");
  }
  return withQuery(next, "key", displayKey);
}

function cacheKey(path: string, displayKey?: string) {
  // Do not persist the credential itself in the cache key; one page instance only
  // serves one TV session and the path is enough to isolate wallboard feeds.
  return `${displayKey ? "tv" : "tms"}:${path}`;
}

function cached<T>(key: string) {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > MAX_CACHE_AGE_MS) {
    responseCache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function transient(error: unknown) {
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500 || error.status === 0;
}

/**
 * Scoped wallboard read helper. It replaces the old global window.fetch patches:
 * - paired TVs keep their key on every wallboard read;
 * - legacy ETA/progress reads use the paired-key proxy;
 * - successful payloads are retained and reused only for transient failures;
 * - 401/403 are never hidden, so expired pairing/auth remains visible.
 */
export async function wallboardRequest<T>(
  path: string,
  token?: string,
  init?: RequestInit,
  displayKey?: string,
): Promise<T> {
  const effectivePath = tvPath(path, displayKey);
  const key = cacheKey(path, displayKey);
  const headers = displayKey
    ? { "X-TMS-TV-Key": displayKey, "X-TV-Display-Key": displayKey, ...(init?.headers || {}) }
    : init?.headers;
  try {
    const value = await request<T>(effectivePath, displayKey ? undefined : token, {
      ...init,
      cache: "no-store",
      headers,
    });
    responseCache.set(key, { value, storedAt: Date.now() });
    return value;
  } catch (error) {
    const previous = transient(error) ? cached<T>(key) : undefined;
    if (previous !== undefined) return previous;
    throw error;
  }
}
