export {};

// Compatibility bridge for older Master Data components that still call the
// operational-master-data archive/restore routes. Keep those visible buttons
// on the same resilient endpoint as the duplicate-cleanup workspace.
const originalFetch = window.fetch.bind(window);

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  const match = raw.match(/\/api\/v1\/operational-master-data\/(drivers|vehicles|trailers|sites|customers|geofences)\/([0-9a-f-]+)\/(archive|restore)(?=$|[?#])/i);
  if (!match) return originalFetch(input, init);

  const replacement = raw.replace(
    match[0],
    `/api/v1/master-data-cleanup/${match[1].toLowerCase()}/${match[2]}/${match[3].toLowerCase()}`,
  );

  if (typeof input === 'string' || input instanceof URL) return originalFetch(replacement, init);
  return originalFetch(new Request(replacement, input), init);
}) as typeof window.fetch;
