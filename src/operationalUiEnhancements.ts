function cleanTitleLine(value: string) {
  return value.replace(/^\s*\d+\.\s*/, "").trim();
}

function compactRunNumber(value: string) {
  const match = value.match(/\b(?:RUN[-\s]*)?(\d{1,3})\b/i);
  return match?.[1] || value.trim();
}

function refreshDispatchRunQueue() {
  const queue = document.querySelector<HTMLElement>('[data-testid="built-runs-queue"]');
  if (!queue) return;
  const cards = Array.from(queue.querySelectorAll<HTMLElement>(':scope > div:last-child > span[title]'));
  for (const card of cards) {
    const lines = (card.getAttribute("title") || "").split("\n").map(cleanTitleLine).filter(Boolean);
    if (!lines.length) continue;
    const strong = card.querySelector<HTMLElement>("strong");
    const details = card.querySelectorAll<HTMLElement>("small");
    if (strong && strong.dataset.compactRunApplied !== "true") {
      strong.textContent = `RUN ${compactRunNumber(strong.textContent || "")}`;
      strong.dataset.compactRunApplied = "true";
    }
    if (details[0]) details[0].textContent = lines.length === 1 ? lines[0] : `${lines[0]} → ${lines.at(-1)}`;
  }
}

export function installOperationalUiEnhancements() {
  if (typeof document === "undefined") return;
  const marker = window as Window & { __SLH_OPERATIONAL_UI_ENHANCEMENTS__?: boolean };
  if (marker.__SLH_OPERATIONAL_UI_ENHANCEMENTS__) return;
  marker.__SLH_OPERATIONAL_UI_ENHANCEMENTS__ = true;

  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(".top-nav-menu a") : null;
    if (!link) return;
    link.closest<HTMLDetailsElement>("details")?.removeAttribute("open");
  });

  const observer = new MutationObserver(refreshDispatchRunQueue);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(refreshDispatchRunQueue, 0);
}
