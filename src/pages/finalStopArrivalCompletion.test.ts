import { describe, expect, it } from "vitest";
import { completedJobCount } from "./operationsWallboardProgress";

describe("Operations wallboard final-stop arrival completion", () => {
  it("counts the final job complete as soon as the vehicle arrives at the final geofence", () => {
    expect(completedJobCount([
      {
        loadId: "load-final",
        loadReference: "Run Final",
        loadStatus: "InProgress",
        runState: "OnSiteConfirmed",
        totalStops: 3,
        completedStops: 2,
        progressPercent: 66,
        nextStop: { id: "stop-3", sequence: 3, name: "Final customer" },
        currentVisit: {
          geofenceName: "Final customer",
          loadStopId: "stop-3",
          enteredAtUtc: "2026-08-25T14:24:00Z",
          dwellMinutes: 60,
          isDelayed: false,
          status: "Arrived",
        },
      },
    ])).toBe(3);
  });

  it("does not count an intermediate on-site visit complete until departure", () => {
    expect(completedJobCount([
      {
        loadId: "load-mid",
        loadReference: "Run Mid",
        loadStatus: "InProgress",
        runState: "OnSiteConfirmed",
        totalStops: 3,
        completedStops: 1,
        progressPercent: 33,
        nextStop: { id: "stop-2", sequence: 2, name: "Middle customer" },
        currentVisit: {
          geofenceName: "Middle customer",
          loadStopId: "stop-2",
          enteredAtUtc: "2026-08-25T14:24:00Z",
          dwellMinutes: 10,
          isDelayed: false,
          status: "Arrived",
        },
      },
    ])).toBe(1);
  });
});
