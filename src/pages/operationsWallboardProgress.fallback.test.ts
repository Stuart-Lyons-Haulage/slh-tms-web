import { describe, expect, it } from "vitest";
import { fallbackLiveRun } from "./operationsWallboardProgress";

describe("wallboard live-run fallback", () => {
  it("keeps live movement and a final planned time visible when enrichment is unavailable", () => {
    const fallback = fallbackLiveRun({
      id: "load-1",
      reference: "RUN 5 PM",
      status: "InProgress",
      nextStop: "Deliver · Aldi-Goldthorpe",
      finalStop: "Deliver · Aldi-Goldthorpe",
      finalPlannedUtc: "2026-09-07T17:55:00Z",
      tracking: "Moving · 42 km/h · now",
      trackingUpdatedAtUtc: "2026-09-07T14:00:00Z",
      speedKph: 42,
      state: "MOVING",
    }, Date.parse("2026-09-07T14:01:00Z"));

    expect(fallback.progress.trackingFresh).toBe(true);
    expect(fallback.progress.trackingMoving).toBe(true);
    expect(fallback.progress.speedKph).toBe(42);
    expect(fallback.progress.nextStop?.name).toBe("Deliver · Aldi-Goldthorpe");
    expect(fallback.eta?.etaUtc).toBe("2026-09-07T17:55:00Z");
    expect(fallback.eta?.source).toBe("Planned");
  });
});
