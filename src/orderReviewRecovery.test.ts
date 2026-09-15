import { describe, expect, it } from "vitest";
import { isPagedStagingQueueRequest, normaliseListPayload } from "./orderReviewRecovery";

describe("normaliseListPayload", () => {
  it("keeps array responses unchanged", () => {
    const rows = [{ id: "1" }, { id: "2" }];
    expect(normaliseListPayload(rows)).toBe(rows);
  });

  it("unwraps common API list envelopes", () => {
    expect(normaliseListPayload({ items: [{ id: "1" }] })).toEqual([{ id: "1" }]);
    expect(normaliseListPayload({ records: [{ id: "2" }] })).toEqual([{ id: "2" }]);
    expect(normaliseListPayload({ data: [{ id: "3" }] })).toEqual([{ id: "3" }]);
  });

  it("can read queue records for recovery lookups without changing the queue response contract", () => {
    const pagedQueue = {
      page: 1,
      pageSize: 100,
      total: 215,
      hasMore: true,
      records: [{ id: "staged-1" }, { id: "staged-2" }],
    };

    expect(isPagedStagingQueueRequest("/api/v1/staging/queue?status=PendingReview&entityType=order&page=1&pageSize=100")).toBe(true);
    expect(normaliseListPayload(pagedQueue)).toEqual(pagedQueue.records);
    expect(pagedQueue).toEqual({
      page: 1,
      pageSize: 100,
      total: 215,
      hasMore: true,
      records: [{ id: "staged-1" }, { id: "staged-2" }],
    });
  });

  it("does not classify ordinary staging detail URLs as paged queue requests", () => {
    expect(isPagedStagingQueueRequest("/api/v1/staging/abc-123")).toBe(false);
    expect(isPagedStagingQueueRequest("/api/v1/staging?status=PendingReview&entityType=order")).toBe(false);
  });

  it("returns an empty list for malformed non-array payloads", () => {
    expect(normaliseListPayload({ unexpected: true })).toEqual([]);
    expect(normaliseListPayload(null)).toEqual([]);
    expect(normaliseListPayload("bad response")).toEqual([]);
  });
});
