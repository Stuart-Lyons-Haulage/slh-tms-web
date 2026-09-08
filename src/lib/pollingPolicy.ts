import { jitteredDelay } from './visiblePolling';

export function effectivePollingDelay(pathname: string, requestedMs: number) {
  const path = pathname.toLowerCase();
  if (path === '/' && requestedMs === 20_000) return 30_000;
  if ((path.startsWith('/operations-wallboard') || path.startsWith('/live-runs') || path === '/tv') && requestedMs === 20_000) return 600_000;
  if (path.startsWith('/warehouse') && requestedMs >= 10_000) return 120_000;
  if (path.startsWith('/communications') && requestedMs >= 10_000) return 120_000;
  if (path.startsWith('/staging') && requestedMs >= 10_000) return 60_000;
  if (path.startsWith('/driver-dispatch') && requestedMs >= 10_000) return 60_000;
  if (path.startsWith('/dashboard') && requestedMs >= 10_000) return 60_000;
  if ((path.startsWith('/compliance') || path.startsWith('/night-outs')) && requestedMs >= 10_000) return 900_000;
  if ((path.startsWith('/control-centre') || path.startsWith('/operations-control') || path.startsWith('/admin')) && requestedMs >= 10_000) return 600_000;
  return requestedMs;
}

export function installPollingPolicy() {
  if (typeof window === 'undefined') return;
  const marker = window as Window & { __SLH_POLLING_POLICY__?: boolean };
  if (marker.__SLH_POLLING_POLICY__) return;
  marker.__SLH_POLLING_POLICY__ = true;

  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const requested = Number(timeout || 0);
    if (requested < 10_000) return nativeSetInterval(handler, timeout, ...args);
    const effective = effectivePollingDelay(window.location.pathname, requested);
    const delay = jitteredDelay(effective);
    const wrapped: TimerHandler = typeof handler === 'function'
      ? (...callbackArgs: unknown[]) => { if (document.visibilityState === 'visible') handler(...callbackArgs); }
      : handler;
    return nativeSetInterval(wrapped, delay, ...args);
  }) as typeof window.setInterval;
}
