import { describe, expect, it } from "vitest";
import { syntheticTimingEtas } from "./OperationsWallboardGeofenceTimed";

describe("Operations wallboard ETA reconstruction after reset/re-import", () => {
  it("builds next and final ETA rows from run-timing when the legacy ETA feed has no rows", () => {
    const rows = syntheticTimingEtas({
      id: "load-23",
      reference: "PLAN-20260826-23",
      status: "InProgress",
      stops: [
        { id: "s1", sequence: 1, name: "NWF Selsey", plannedArrivalUtc: "2026-08-26T07:00:00Z" },
        { id: "s2", sequence: 2, name: "NWF Merston", plannedArrivalUtc: "2026-08-26T08:00:00Z" },
        { id: "s3", sequence: 3, name: "Morrisons Sittingbourne", plannedArrivalUtc: "2026-08-26T16:00:00Z" },
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

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      loadId: "load-23",
      loadReference: "Run 23 AM",
      stopId: "s2",
      etaUtc: "2026-08-26T12:10:00Z",
      source: "Live",
    });
    expect(rows[1]).toMatchObject({
      stopId: "s3",
      etaUtc: "2026-08-26T15:50:00Z",
      source: "Estimated",
      deliveryWindowEndUtc: "2026-08-26T16:00:00Z",
    });
  });
});
