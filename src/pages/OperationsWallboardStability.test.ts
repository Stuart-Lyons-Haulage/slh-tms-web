import { describe, expect, it } from "vitest";
import { isFinalCurrentVisit, normaliseFinalArrival, retainUsefulEtas } from "./OperationsWallboardStability";

describe("wallboard stability guards", () => {
  it("recognises a live visit at the final planned stop", () => {
    const record = {
      loadId: "run-6",
      totalStops: 4,
      completedStops: 3,
      currentVisit: { loadStopId: "final", enteredAtUtc: "2026-08-26T13:43:00Z", confirmedAtUtc: "2026-08-26T13:45:00Z", isDelayed: true, dwellMinutes: 67, liveDwellMinutes: 67, liveDwellSeconds: 4020 },
      stopDwell: [{ stopId: "final", sequence: 4 }],
    };

    expect(isFinalCurrentVisit(record)).toBe(true);
    const normalised = normaliseFinalArrival(record);
    expect(normalised.currentVisit?.isDelayed).toBe(false);
    expect(normalised.currentVisit?.confirmedAtUtc).toBeUndefined();
    expect(normalised.currentVisit?.dwellMinutes).toBe(0);
    expect(normalised.currentVisit?.liveDwellMinutes).toBeUndefined();
  });

  it("does not suppress dwell for an intermediate site", () => {
    const record = {
      loadId: "run-22",
      totalStops: 5,
      completedStops: 2,
      currentVisit: { loadStopId: "middle", confirmedAtUtc: "2026-08-26T13:45:00Z", isDelayed: true, dwellMinutes: 70 },
      stopDwell: [{ stopId: "middle", sequence: 3 }],
    };

    expect(isFinalCurrentVisit(record)).toBe(false);
    expect(normaliseFinalArrival(record)).toEqual(record);
  });

  it("retains the last useful ETA when a later refresh temporarily loses it", () => {
    const cache = new Map();
    const active = new Set(["run-22"]);
    const first = retainUsefulEtas([
      { loadId: "run-22", stopId: "final", sequence: 5, etaUtc: "2026-08-26T21:19:00Z", source: "Live", risk: "AtRisk" },
    ], cache, active, 1_000);
    expect(first[0].etaUtc).toBe("2026-08-26T21:19:00Z");

    const second = retainUsefulEtas([
      { loadId: "run-22", stopId: "final", sequence: 5, source: "Unavailable", risk: "Pending" },
    ], cache, active, 21_000);
    expect(second[0].etaUtc).toBe("2026-08-26T21:19:00Z");
    expect(second[0].source).toBe("Live");
    expect(second[0].risk).toBe("AtRisk");
  });

  it("restores a temporarily omitted ETA row only while its run remains active", () => {
    const cache = new Map();
    retainUsefulEtas([
      { loadId: "run-5", stopId: "final", sequence: 4, etaUtc: "2026-08-26T14:52:00Z", source: "Estimated" },
    ], cache, new Set(["run-5"]), 1_000);

    const restored = retainUsefulEtas([], cache, new Set(["run-5"]), 21_000);
    expect(restored).toHaveLength(1);
    expect(restored[0].etaUtc).toBe("2026-08-26T14:52:00Z");

    const removed = retainUsefulEtas([], cache, new Set(), 41_000);
    expect(removed).toHaveLength(0);
  });
});
