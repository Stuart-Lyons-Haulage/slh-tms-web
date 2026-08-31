const PLANNING_CHANGED_EVENT = "slh:orders-changed";
const PLANNING_CHANGED_STORAGE_KEY = "slh:planning-changed-at";
const PLANNING_CHANNEL = "slh-tms-planning";

let channel: BroadcastChannel | undefined;
function getChannel() {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  channel ??= new BroadcastChannel(PLANNING_CHANNEL);
  return channel;
}

export function signalPlanningChange() {
  const changedAt = Date.now();
  window.dispatchEvent(new Event(PLANNING_CHANGED_EVENT));
  try {
    window.localStorage.setItem(PLANNING_CHANGED_STORAGE_KEY, String(changedAt));
  } catch {
    // Some locked-down displays disable storage; same-window refresh still works.
  }
  try {
    getChannel()?.postMessage({ changedAt });
  } catch {
    // BroadcastChannel is an enhancement only; storage/local events remain authoritative.
  }
}

export function subscribePlanningChanges(listener: () => void) {
  const onLocalChange = () => listener();
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === PLANNING_CHANGED_STORAGE_KEY) listener();
  };
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
