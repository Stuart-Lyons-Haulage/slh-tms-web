import { describe, expect, it } from "vitest";
import { displayRunReference } from "./runDisplay";

describe("displayRunReference", () => {
  it("uses the operational first stop instead of stale AM planner metadata", () => {
    const label = displayRunReference(
      "PLAN-20260828-2",
      "Planner run: Run 2 AM | Run type: AM",
      "2026-08-27T16:00:00Z",
    );

    expect(label).toBe("Run 2 PM");
  });

  it("keeps a genuine morning run as AM", () => {
    const label = displayRunReference(
      "PLAN-20260828-1",
      "Planner run: Run 1 AM | Run type: AM",
      "2026-08-28T04:30:00Z",
    );

    expect(label).toBe("Run 1 AM");
  });
});
