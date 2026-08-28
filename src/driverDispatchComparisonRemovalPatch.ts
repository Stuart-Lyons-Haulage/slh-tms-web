const DRIVER_DISPATCH_PATH = "/driver-dispatch";
const LEGACY_YESTERDAY_LABEL = "open yesterday";

export function normaliseDriverDispatchComparisonUrl(location = window.location) {
  if (location.pathname !== DRIVER_DISPATCH_PATH) return;
  const params = new URLSearchParams(location.search);
  if (!params.has("compare")) return;
  params.delete("compare");
  const query = params.toString();
  window.history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash || ""}`);
}

export function removeLegacyYesterdayAction(root: ParentNode = document) {
  if (window.location.pathname !== DRIVER_DISPATCH_PATH) return;
  root.querySelectorAll<HTMLButtonElement>(".dispatch-actions button").forEach(button => {
    if (button.textContent?.trim().toLowerCase().startsWith(LEGACY_YESTERDAY_LABEL)) button.remove();
  });
}

normaliseDriverDispatchComparisonUrl();

const observer = new MutationObserver(() => removeLegacyYesterdayAction());
observer.observe(document.documentElement, { childList: true, subtree: true });
removeLegacyYesterdayAction();
