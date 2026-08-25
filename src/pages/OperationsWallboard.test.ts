import { describe, expect, it } from "vitest";
import { completedJobCount, finalEtaFor, mergeRouteProgress, statusFor } from "./operationsWallboardProgress";

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

  it("keeps an allocated started fallback route scheduled until live evidence arrives", () => {
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
      status: "scheduled",
      label: "SCHEDULED",
      detail: "NWF Selsey",
    });
  });

  it("does not claim a run is late when the planned time has passed but live evidence is missing", () => {
    const now = Date.parse("2026-08-25T12:00:00Z");
    expect(statusFor({
      loadId: "load-1",
      loadReference: "Run 1 AM",
      loadStatus: "Planned",
      runState: "Planned",
      totalStops: 2,
      completedStops: 0,
      progressPercent: 0,
      nextStop: { id: "stop-1", sequence: 1, name: "NWF Selsey", plannedArrivalUtc: "2026-08-25T11:00:00Z" },
    }, undefined, [], now)).toMatchObject({
      status: "risk",
      label: "ETA UNCONFIRMED",
    });
  });

  it("selects the last remaining stop for the displayed final ETA", () => {
    expect(finalEtaFor([
      { sequence: 2, stopName: "Middle", etaUtc: "2026-08-25T12:30:00Z", source: "Live" },
      { sequence: 3, stopName: "Final", etaUtc: "2026-08-25T13:15:00Z", source: "Live" },
      { sequence: 1, stopName: "First", etaUtc: "2026-08-25T12:00:00Z", source: "Live" },
    ] as never[])).toMatchObject({ sequence: 3, stopName: "Final" });
  });
});
