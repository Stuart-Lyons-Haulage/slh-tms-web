import { describe, expect, it } from "vitest";
import { mergeRouteProgress, type RouteProgressRun, type RunProgressRecord } from "./operationsWallboardProgress";

function durableProgress(): RunProgressRecord {
  return {
    loadId: "load-1",
    loadReference: "Run 1 AM",
    loadStatus: "Planned",
    runState: "OnSiteConfirmed",
    totalStops: 4,
    completedStops: 1,
    progressPercent: 25,
    phase: "On site",
    focusStop: "NWF-Selsey",
    geofenceOnSite: true,
    trackingFresh: true,
    trackingMoving: false,
    ignitionOn: true,
    driverCardPresent: true,
    currentVisit: {
      geofenceName: "NWF-Selsey",
      loadStopId: "stop-2",
      enteredAtUtc: "2026-08-27T06:30:00Z",
      confirmedAtUtc: "2026-08-27T06:40:00Z",
      dwellMinutes: 12,
      isDelayed: false,
      status: "OnSiteConfirmed",
    },
    stopDwell: [
      { stopId: "stop-1", sequence: 1, stopName: "Collect A", state: "Departed" },
      { stopId: "stop-2", sequence: 2, stopName: "Collect B", state: "OnSite" },
    ],
    nextStop: { id: "stop-2", sequence: 2, name: "Collect B" },
  };
}

function weakerRoute(): RouteProgressRun {
  return {
    loadId: "load-1",
    reference: "Run 1 AM",
    totalStops: 4,
    completedStops: 0,
    phase: "Next job",
    truckPositionPercent: 0,
    focusStop: "Collect A",
    geofenceOnSite: false,
    trackingFresh: false,
    trackingMoving: false,
    currentVisit: null,
    stopDwell: [
      { stopId: "stop-1", sequence: 1, stopName: "Collect A", state: "EnRoute" },
      { stopId: "stop-2", sequence: 2, stopName: "Collect B", state: "EnRoute" },
    ],
    stops: [
      { id: "stop-1", sequence: 1, name: "Collect A", state: "heading" },
      { id: "stop-2", sequence: 2, name: "Collect B", state: "upcoming" },
    ],
  };
}

describe("wallboard route merge", () => {
  it("does not erase stronger geofence progress with a weaker route snapshot", () => {
    const [merged] = mergeRouteProgress([durableProgress()], [weakerRoute()]);

    expect(merged.completedStops).toBe(1);
    expect(merged.currentVisit?.geofenceName).toBe("NWF-Selsey");
    expect(merged.geofenceOnSite).toBe(true);
    expect(merged.phase).toBe("On site");
    expect(merged.nextStop?.id).toBe("stop-2");
    expect(merged.stopDwell?.find(stop => stop.stopId === "stop-1")?.state).toBe("Departed");
  });

  it("never regresses a completed run", () => {
    const completed = durableProgress();
    completed.runState = "Completed";
    completed.completedStops = 4;
    completed.progressPercent = 100;
    completed.currentVisit = null;
    completed.geofenceOnSite = false;

    const [merged] = mergeRouteProgress([completed], [weakerRoute()]);

    expect(merged.runState).toBe("Completed");
    expect(merged.completedStops).toBe(4);
    expect(merged.progressPercent).toBe(100);
  });
});
