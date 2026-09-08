import { apiBaseUrl } from './api';

const PLANNING_CHANGED_EVENT = "slh:orders-changed";
const PLANNING_CHANGED_STORAGE_KEY = "slh:planning-changed-at";
const PLANNING_CHANNEL = "slh-tms-planning";

let channel: BroadcastChannel | undefined;
function getChannel() {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  channel ??= new BroadcastChannel(PLANNING_CHANNEL);
  return channel;
}

function emitPlanningChange(broadcast = true) {
  const changedAt = Date.now();
  window.dispatchEvent(new Event(PLANNING_CHANGED_EVENT));
  try { window.localStorage.setItem(PLANNING_CHANGED_STORAGE_KEY, String(changedAt)); } catch { }
  if (!broadcast) return;
  try { getChannel()?.postMessage({ changedAt }); } catch { }
}

export function signalPlanningChange() {
  emitPlanningChange(true);
}

export function subscribePlanningChanges(listener: () => void) {
  const onLocalChange = () => listener();
  const onStorageChange = (event: StorageEvent) => { if (event.key === PLANNING_CHANGED_STORAGE_KEY) listener(); };
  const broadcastChannel = getChannel();
  const onBroadcast = () => listener();
  window.addEventListener(PLANNING_CHANGED_EVENT, onLocalChange);
  window.addEventListener("storage", onStorageChange);
  broadcastChannel?.addEventListener('message', onBroadcast);
  return () => {
    window.removeEventListener(PLANNING_CHANGED_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorageChange);
    broadcastChannel?.removeEventListener('message', onBroadcast);
  };
}

export function connectPlanningEventStream(token: string) {
  const controller = new AbortController();
  let stopped = false;
  let retryTimer: number | undefined;

  const connect = async () => {
    if (stopped) return;
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/planning-events/stream`, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Planning event stream failed (${response.status}).`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.split('\n').some(line => line.trim() === 'event: planning-data-changed')) emitPlanningChange(true);
          boundary = buffer.indexOf('\n\n');
        }
      }
      if (!stopped) retryTimer = window.setTimeout(() => void connect(), 3000 + Math.random() * 2000);
    } catch (error) {
      if (stopped || controller.signal.aborted) return;
      console.warn('Planning real-time stream unavailable; 30-second reconciliation remains active.', error);
      retryTimer = window.setTimeout(() => void connect(), 5000 + Math.random() * 3000);
    }
  };

  void connect();
  return () => {
    stopped = true;
    controller.abort();
    if (retryTimer) window.clearTimeout(retryTimer);
  };
}
