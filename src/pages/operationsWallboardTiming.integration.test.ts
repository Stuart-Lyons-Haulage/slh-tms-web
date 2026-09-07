import { describe, expect, it } from "vitest";
import { enrichWallboardLiveFeeds } from "./operationsWallboardTiming";

describe("Operations wallboard explicit live-feed enrichment", () => {
  it("enriches the final ETA and route destination without a global fetch patch", () => {
    const lastTiming = new Map();
    const acceptedFinalEtas = new Map();

    const result = enrichWallboardLiveFeeds(
      [
        {
          loadId: "load-1",
          loadReference: "Run 1",
          stopId: "delivery",
          sequence: 2,
          stopName: "Deliver · Customer",
          etaUtc: "2026-09-07T12:30:00Z",
          source: "Estimated",
          deliveryWindowEndUtc: "2026-09-07T13:00:00Z",
        },
      ] as never[],
      [
        {
          loadId: "load-1",
          loadReference: "Run 1",
          completed: false,
          finalDestinationStopId: "delivery",
          finalDestinationName: "Customer",
          finalEtaUtc: "2026-09-07T12:15:00Z",
          finalEtaSource: "Geofence",
        },
      ],
      [
        {
          loadId: "load-1",
          reference: "Run 1",
          focusStop: "Depot return",
          stops: [
            { id: "delivery", sequence: 2, name: "Deliver · Customer" },
            { id: "return", sequence: 3, name: "Depot return" },
          ],
        },
      ] as never[],
      lastTiming,
      acceptedFinalEtas,
    );

    expect(result.etas[0]).toMatchObject({
      stopId: "delivery",
      etaUtc: "2026-09-07T12:15:00Z",
      source: "Live",
      isFinalDestination: true,
    });
    expect(result.routeRuns[0].focusStop).toBe("Depot return · Final: Customer");
  });
});
