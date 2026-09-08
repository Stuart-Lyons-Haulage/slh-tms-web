type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normaliseListPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["items", "records", "results", "data", "value"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function reviewIdFromLocation() {
  if (window.location.pathname !== "/staging") return undefined;
  return new URLSearchParams(window.location.search).get("reviewId") || undefined;
}

function revealTargetReview() {
  const reviewId = reviewIdFromLocation();
  if (!reviewId) return;

  const showAll = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .find((input) => input.parentElement?.textContent?.includes("Show all pending dates"));
  if (showAll && !showAll.checked) {
    showAll.click();
    return;
  }

  const cards = Array.from(document.querySelectorAll<HTMLElement>(".order-review-card"));
  const target = cards.find((card) =>
    card.dataset.reviewId === reviewId
    || card.dataset.id === reviewId
    || card.id === reviewId
    || Boolean(card.querySelector(`[data-review-id="${CSS.escape(reviewId)}"]`)),
  );

  if (!target || target.dataset.reviewTarget === reviewId) return;
  target.dataset.reviewTarget = reviewId;
  target.style.outline = "3px solid #63d151";
  target.style.outlineOffset = "4px";
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * Legacy recovery remains DOM-scoped only. Source-email evidence is now handled by
 * OrderControl/OrderReviewBulk directly, so the old browser-wide fetch interceptor is
 * no longer needed and cannot interfere with live wallboard traffic.
 */
export function installOrderReviewRecovery() {
  if (typeof window === "undefined") return;
  const marker = window as Window & { __SLH_ORDER_REVIEW_RECOVERY__?: boolean };
  if (marker.__SLH_ORDER_REVIEW_RECOVERY__) return;
  marker.__SLH_ORDER_REVIEW_RECOVERY__ = true;

  const observer = new MutationObserver(() => revealTargetReview());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(revealTargetReview, 0);
}
