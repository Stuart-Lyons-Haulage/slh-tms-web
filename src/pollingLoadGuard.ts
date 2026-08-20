// Reduce unnecessary background polling across the TMS without affecting short UI timers.
// Operational polling should pause while a tab is hidden, and the wallboard's historical
// 20-second cadence is deliberately relaxed to 60 seconds.

const nativeSetInterval = window.setInterval.bind(window);
const operationalPollThresholdMs = 15_000;
const wallboardLegacyPollMs = 20_000;
const wallboardPollMs = 60_000;
const wallboardPaths = new Set(['/tv', '/operations-wallboard', '/operations-wallboard/tv', '/live-runs', '/live-runs/tv', '/tv-display']);

window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const requestedMs = Number(timeout ?? 0);
  const effectiveMs = wallboardPaths.has(window.location.pathname) && requestedMs === wallboardLegacyPollMs
    ? wallboardPollMs
    : requestedMs;

  if (typeof handler !== 'function' || effectiveMs < operationalPollThresholdMs) {
    return nativeSetInterval(handler, effectiveMs, ...args);
  }

  const guardedHandler = () => {
    // Hidden browser tabs do not need to keep hitting RoadTech, ETA, geofence or
    // intelligence endpoints. The next visible interval will refresh normally.
    if (document.visibilityState === 'hidden') return;
    handler(...args);
  };

  return nativeSetInterval(guardedHandler, effectiveMs);
}) as typeof window.setInterval;
