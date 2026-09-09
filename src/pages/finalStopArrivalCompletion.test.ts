import { describe, expect, it } from "vitest";
import { completedJobCount, shouldDisplayWallboardRow, statusFor } from "./operationsWallboardProgress";

describe("Operations wallboard final-stop arrival completion", () => {
  it("keeps final-geofence entry as arrived without counting the stop complete or making the driver available", () => {
    const progress = {
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
    };

    expect(completedJobCount([progress])).toBe(2);
    expect(statusFor(progress, undefined, [])).toMatchObject({ status: "onsite", label: "ARRIVED" });
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

  it("does not infer final arrival merely because every earlier geofence has exited", () => {
    const progress = {
      loadId: "run-7",
      loadReference: "Run 7",
      loadStatus: "InProgress",
      runState: "BetweenStops",
      totalStops: 3,
      completedStops: 2,
      progressPercent: 66.7,
      nextStop: { id: "stop-3", sequence: 3, name: "Deliver · Morrisons-LatimerPark" },
      stopDwell: [
        { stopId: "stop-1", sequence: 1, stopName: "Collect · Merston", state: "Departed" as const },
        { stopId: "stop-2", sequence: 2, stopName: "Collect · NWF-Selsey", state: "Departed" as const },
        { stopId: "stop-3", sequence: 3, stopName: "Deliver · Morrisons-LatimerPark", state: "EnRoute" as const },
      ],
      trackingFresh: true,
      trackingMoving: true,
      speedKph: 81,
      focusStop: "Morrisons-LatimerPark",
    };

    expect(completedJobCount([progress])).toBe(2);
    expect(statusFor(progress, undefined, [])).toMatchObject({ status: "route", label: "ON ROUTE" });
  });

  it("keeps a final-destination vehicle resting on site as arrived, but not available until final departure", () => {
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
      geofenceOnSite: true,
      focusStop: "Final customer",
    };

    const status = statusFor(progress, undefined, [], now);
    expect(status).toMatchObject({ status: "onsite", label: "ON SITE" });
    expect(shouldDisplayWallboardRow({ id: "load-rest", status: status.status, finalDestinationArrived: true }, true, now)).toBe(false);
  });

  it("marks the driver available only after the final stop has completed", () => {
    const progress = {
      loadId: "load-done",
      loadReference: "Run Done",
      loadStatus: "Completed",
      runState: "Completed",
      totalStops: 3,
      completedStops: 3,
      progressPercent: 100,
      stopDwell: [
        { stopId: "stop-1", sequence: 1, stopName: "Collect · Merston", state: "Departed" as const },
        { stopId: "stop-2", sequence: 2, stopName: "Collect · Selsey", state: "Departed" as const },
        { stopId: "stop-3", sequence: 3, stopName: "Deliver · Final customer", state: "Departed" as const, siteDepartureUtc: "2026-09-09T09:30:00Z" },
      ],
    };

    expect(statusFor(progress, undefined, [])).toMatchObject({ status: "complete", label: "AVAILABLE" });
  });
});
