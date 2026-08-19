export {};

const originalFetch = window.fetch.bind(window);
let recentReason: { value: string; at: number } | undefined;

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await originalFetch(input, init);
  if (response.status !== 409) return response;

  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.includes('/api/v1/loads') && !url.includes('/api/v1/runs')) return response;

  let payload: { detail?: string } | null = null;
  try { payload = await response.clone().json(); } catch { return response; }
  if (!payload?.detail?.startsWith('PLAN_LOCKED:')) return response;

  const now = Date.now();
  const cached = recentReason && now - recentReason.at < 30_000 ? recentReason.value : undefined;
  const reason = cached || window.prompt('This planning day is locked. Enter the reason for this change:')?.trim();
  if (!reason) return response;
  recentReason = { value: reason, at: now };

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('X-Plan-Change-Reason', reason);
  return originalFetch(input, { ...init, headers });
};
