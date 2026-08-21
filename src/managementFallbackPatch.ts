const originalFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await originalFetch(input, init);
  if (response.ok) return response;

  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  const marker = '/api/v1/management/summary';
  const markerIndex = rawUrl.indexOf(marker);
  if (markerIndex < 0) return response;

  const resilientUrl = `${rawUrl.slice(0, markerIndex)}/api/v1/management/resilient-summary${rawUrl.slice(markerIndex + marker.length)}`;
  try {
    const fallback = await originalFetch(resilientUrl, init);
    if (fallback.ok) {
      console.warn('Primary management summary failed; resilient management summary was used instead.');
      return fallback;
    }
  } catch (error) {
    console.warn('Management fallback request also failed.', error);
  }

  return response;
};
