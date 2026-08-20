const PLANNING_CHANGED_EVENT = "slh:orders-changed";
const PLANNING_CHANGED_STORAGE_KEY = "slh:planning-changed-at";

export function signalPlanningChange() {
  window.dispatchEvent(new Event(PLANNING_CHANGED_EVENT));
  try {
    window.localStorage.setItem(PLANNING_CHANGED_STORAGE_KEY, String(Date.now()));
  } catch {
    // Some locked-down displays disable storage; same-window refresh still works.
  }
}

export function subscribePlanningChanges(listener: () => void) {
  const onLocalChange = () => listener();
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === PLANNING_CHANGED_STORAGE_KEY) listener();
  };

  window.addEventListener(PLANNING_CHANGED_EVENT, onLocalChange);
  window.addEventListener("storage", onStorageChange);

  return () => {
    window.removeEventListener(PLANNING_CHANGED_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorageChange);
  };
}
