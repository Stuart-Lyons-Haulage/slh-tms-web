type UnknownRecord = Record<string, unknown>;

const LIST_ENDPOINTS = [
  "/api/v1/staging",
  "/api/v1/operational-master-data/sites/search",
  "/api/v1/operational-master-data/geofences/search",
];

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

function isListRequest(url: string) {
  return LIST_ENDPOINTS.some((endpoint) => url.includes(endpoint));
}

function reviewIdFromLocation() {
  if (window.location.pathname !== "/staging") return undefined;
  return new URLSearchParams(window.location.search).get("reviewId") || undefined;
}

let targetReview: UnknownRecord | undefined;
let targetLookupFinished = false;

function captureTargetReview(rows: unknown[]) {
  const reviewId = reviewIdFromLocation();
  if (!reviewId) return;
  targetLookupFinished = true;
  targetReview = rows.find((row) => isRecord(row) && String(row.id ?? "") === reviewId) as UnknownRecord | undefined;
}

function parsePayloadJson(row: UnknownRecord | undefined): UnknownRecord {
  if (!row) return {};
  const raw = row.payloadJson;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function targetNeedles(row: UnknownRecord | undefined) {
  const payload = parsePayloadJson(row);
  return [
    payload.poNumber,
    payload.customerPo,
    payload.sourceSubject,
    payload.sourceSender,
    payload.sourceSenderName,
    payload.sourceAttachmentName,
  ]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length >= 4);
}

function addMissingTargetNotice() {
  if (!reviewIdFromLocation() || targetReview || !targetLookupFinished) return;
  if (document.querySelector("[data-order-review-target-missing]")) return;
  const toolbar = document.querySelector(".review-toolbar");
  if (!toolbar?.parentElement) return;
  const notice = document.createElement("div");
  notice.dataset.orderReviewTargetMissing = "true";
  notice.className = "notice inline-notice";
  notice.textContent = "This review is no longer in the pending queue or could not be loaded. It may already have been accepted or rejected.";
  toolbar.parentElement.insertBefore(notice, toolbar.nextSibling);
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

  if (!targetReview) {
    addMissingTargetNotice();
    return;
  }

  const needles = targetNeedles(targetReview);
  if (!needles.length) return;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".order-review-card"));
  const target = cards
    .map((card) => ({ card, score: needles.filter((needle) => card.textContent?.includes(needle)).length }))
    .sort((left, right) => right.score - left.score)[0];
  if (!target || target.score === 0) return;

  if (target.card.dataset.reviewTarget !== reviewId) {
    target.card.dataset.reviewTarget = reviewId;
    target.card.style.outline = "3px solid #63d151";
    target.card.style.outlineOffset = "4px";
    target.card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function installOrderReviewRecovery() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const marker = window as Window & { __SLH_ORDER_REVIEW_RECOVERY__?: boolean };
  if (marker.__SLH_ORDER_REVIEW_RECOVERY__) return;
  marker.__SLH_ORDER_REVIEW_RECOVERY__ = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
    if (!response.ok || !isListRequest(url)) return response;

    try {
      const payload = await response.clone().json();
      const rows = normaliseListPayload(payload);
      if (url.includes("/api/v1/staging")) captureTargetReview(rows);
      if (Array.isArray(payload)) return response;
      return new Response(JSON.stringify(rows), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  };

  const observer = new MutationObserver(() => revealTargetReview());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(revealTargetReview, 0);
}
