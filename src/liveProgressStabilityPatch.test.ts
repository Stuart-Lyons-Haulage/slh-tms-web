import { describe, expect, it } from "vitest";
import { isDegradedProgressRefresh } from "./liveProgressStabilityPatch";

describe("live progress refresh stability", () => {
  it("recognises the API safe fallback as degraded", () => {
    expect(isDegradedProgressRefresh({ source: "PlanningRegisterSafeFallback" })).toBe(true);
  });

  it("keeps normal embedded geofence responses healthy", () => {
    expect(isDegradedProgressRefresh({ source: "PlanningRegister+EmbeddedSLHGeofences" })).toBe(false);
  });
});
