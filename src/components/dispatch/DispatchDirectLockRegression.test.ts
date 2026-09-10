import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DispatchBoard.tsx", import.meta.url), "utf8");

describe("direct Dispatch lock preparation", () => {
  it("recalculates the selected driver's Tacho time when the rest choice is stale", () => {
    expect(source).toContain("availableTimes[driver.driverId]?.requiredRestPeriod !== (effectiveSelection.useReducedDailyRest ? 9 : 11)");
    expect(source).toContain("getAvailableTimes(");
    expect(source).toContain("lockDispatchPlan(planningDate, [{ driverId: driver.driverId, selection: effectiveSelection }], access)");
  });
});
