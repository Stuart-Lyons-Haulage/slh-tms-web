import { describe, expect, it } from "vitest";
import { completedJobCount, mergeRouteProgress, statusFor } from "./operationsWallboardProgress";

describe("OperationsWallboard route progress merge", () => {
  it("keeps live TV route fields when refreshing an existing progression record", () => {
    const [merged] = mergeRouteProgress([
      {
        loadId: "load-1",
        loadReference: "Run 1 AM",
        loadStatus: "Planned",
        runState: "Planned",
        totalStops: 2,
        completedStops: 0,
        progressPercent: 0,
      },
    ], [
      {
        loadId: "load-1",
        reference: "Run 1 AM",
        phase: "Heading to",
        focusStop: "NWF Merston",
        totalStops: 2,
        completedStops: 1,
        truckPositionPercent: 68,
        nextStopId: "stop-2",
        geofenceOnSite: false,
        trackingFresh: true,
        trackingMoving: true,
        speedKph: 44,
        stops: [
          { id: "stop-1", sequence: 1, name: "Aldi Swindon", state: "completed" },
          { id: "stop-2", sequence: 2, name: "NWF Merston", state: "heading" },
        ],
      },
    ]);

    expect(merged).toMatchObject({
      runState: "InProgress",
      completedStops: 1,
      progressPercent: 68,
      phase: "Heading to",
      focusStop: "NWF Merston",
      trackingFresh: true,
      trackingMoving: true,
      speedKph: 44,
      nextStop: { id: "stop-2", name: "NWF Merston" },
    });

    expect(statusFor(merged, undefined, [])).toMatchObject({
      status: "route",
      label: "ON ROUTE",
      detail: "NWF Merston · 44 km/h",
    });
  });

  it("counts departed geofenced stops as completed jobs before the run is fully available", () => {
    expect(completedJobCount([
      {
        loadId: "load-1",
        loadReference: "Run 1 AM",
        loadStatus: "InProgress",
        runState: "BetweenStops",
        totalStops: 3,
        completedStops: 2,
        progressPercent: 66,
      },
      {
        loadId: "load-2",
        loadReference: "Run 2 AM",
        loadStatus: "InProgress",
        runState: "OnSiteConfirmed",
        totalStops: 2,
        completedStops: 1,
        progressPercent: 50,
      },
    ])).toBe(3);
  });

  it("shows an allocated started fallback route as on route instead of scheduled", () => {
    expect(statusFor({
      loadId: "load-1",
      loadReference: "Run 1 AM",
      loadStatus: "Planned",
      runState: "InProgress",
      totalStops: 4,
      completedStops: 0,
      progressPercent: 0,
      nextStop: { id: "stop-1", sequence: 1, name: "NWF Selsey" },
    }, undefined, [])).toMatchObject({
      status: "route",
      label: "ON ROUTE",
      detail: "NWF Selsey",
    });
  });
});
