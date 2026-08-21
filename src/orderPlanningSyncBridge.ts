// Synchronises planner/order allocation changes between tabs without making either
// screen depend on a slow polling interval. Existing screens already listen for
// `slh:orders-changed`; this bridge forwards that event through BroadcastChannel
// and localStorage, while preventing a received event from being rebroadcast.

const EVENT_NAME = "slh:orders-changed";
const STORAGE_KEY = "slh:orders-changed-pulse";
const CHANNEL_NAME = "slh-order-planning";

let forwardingRemoteEvent = false;
let channel: BroadcastChannel | undefined;

function dispatchRemoteChange() {
  forwardingRemoteEvent = true;
  try {
    window.dispatchEvent(new Event(EVENT_NAME));
  } finally {
    forwardingRemoteEvent = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener(EVENT_NAME, () => {
    if (forwardingRemoteEvent) return;
    const pulse = { at: Date.now() };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pulse)); } catch { /* optional transport */ }
    try { channel?.postMessage(pulse); } catch { /* optional transport */ }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) dispatchRemoteChange();
  });

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = () => dispatchRemoteChange();
  }
}
