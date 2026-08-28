function dateKey(value?: string) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : undefined;
}

export function stableFinalEta(candidate: string | undefined, fallback: string | undefined, deadline: string | undefined, previous: string | undefined) {
  const candidateMs = candidate ? Date.parse(candidate) : Number.NaN;
  if (!Number.isFinite(candidateMs)) return previous || fallback;
  const now = Date.now();
  const deadlineDay = dateKey(deadline);
  const candidateDay = dateKey(candidate);
  const fallbackMs = fallback ? Date.parse(fallback) : Number.NaN;
  const fallbackDay = dateKey(fallback);
  const previousDay = dateKey(previous);
  // Do not allow a transient overnight calculation to replace a same-day ETA.
  if (deadlineDay && candidateDay !== deadlineDay && (fallbackDay === deadlineDay || previousDay === deadlineDay)) {
    return previous && previousDay === deadlineDay ? previous : fallback;
  }
  // Do not replace a future planned/live ETA with a value already in the past.
  if (Number.isFinite(fallbackMs) && fallbackMs > now && candidateMs < now - 15 * 60_000) {
    return previous || fallback;
  }
  return candidate;
}
