import { describe, expect, it } from "vitest";
import { syntheticTimingEtas } from "./OperationsWallboardGeofenceTimed";

describe("Operations wallboard reset/re-import ETA handoff", () => {
  it("synthesizes next and final ETA rows when the legacy delivery ETA feed is empty", () => {
    const records = syntheticTimingEtas({
      id: "load-23",
      reference: "PLAN-20260826-23",
      status: "Cancelled",
      stops: [
        { id: "s1", sequence: 1, name: "Collect · NWF-Selsey", plannedArrivalUtc: "2026-08-26T07:00:00Z" },
        { id: "s2", sequence: 2, name: "Collect · NWF-Merston", plannedArrivalUtc: "2026-08-26T08:00:00Z" },
        { id: "s3", sequence: 3, name: "Deliver · Morrisons-Sittingbourne", plannedArrivalUtc: "2026-08-26T16:00:00Z" },
      ],
    }, {
      loadId: "load-23",
      loadReference: "Run 23 AM",
      completed: false,
      nextStopId: "s2",
      nextStopSequence: 2,
      nextEtaUtc: "2026-08-26T12:10:00Z",
      etaSource: "Geofence",
      finalEtaUtc: "2026-08-26T15:50:00Z",
      finalEtaSource: "GeofenceEstimated",
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      loadId: "load-23",
      loadReference: "Run 23 AM",
      stopId: "s2",
      etaUtc: "2026-08-26T12:10:00Z",
      source: "Live",
    });
    expect(records[1]).toMatchObject({
      stopId: "s3",
      etaUtc: "2026-08-26T15:50:00Z",
      source: "Estimated",
      deliveryWindowEndUtc: "2026-08-26T16:00:00Z",
    });
  });
});
