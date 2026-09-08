import { describe, expect, it } from "vitest";
import { completedJobCount, shouldDisplayWallboardRow, statusFor } from "./operationsWallboardProgress";

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

  it("treats a final-destination vehicle resting on site overnight as arrived, not an active stale run", () => {
    const now = Date.parse("2026-09-08T08:00:00Z");
    const progress = {
      loadId: "load-rest",
      loadReference: "Run 9 PM",
      loadStatus: "InProgress",
      runState: "OnSiteConfirmed",
      totalStops: 4,
      completedStops: 3,
      progressPercent: 75,
      stopDwell: [
        { stopId: "stop-1", sequence: 1, stopName: "Collect · Selsey", state: "Departed" as const },
        { stopId: "stop-2", sequence: 2, stopName: "Collect · Merston", state: "Departed" as const },
        { stopId: "stop-3", sequence: 3, stopName: "Deliver · Customer A", state: "Departed" as const },
        { stopId: "stop-4", sequence: 4, stopName: "Deliver · Final customer", state: "OnSite" as const, siteArrivalUtc: "2026-09-07T23:00:00Z" },
      ],
    };

    const status = statusFor(progress, undefined, [], now);
    expect(status).toMatchObject({ status: "complete", label: "AVAILABLE" });
    expect(shouldDisplayWallboardRow({ id: "load-rest", status: status.status, finalDestinationArrived: true }, true, now)).toBe(false);
  });
});
