import { describe, expect, it } from "vitest";
import { normaliseListPayload } from "./orderReviewRecovery";

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

  it("returns an empty list for malformed non-array payloads", () => {
    expect(normaliseListPayload({ unexpected: true })).toEqual([]);
    expect(normaliseListPayload(null)).toEqual([]);
    expect(normaliseListPayload("bad response")).toEqual([]);
  });
});
