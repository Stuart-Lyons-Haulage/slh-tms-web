import { describe, expect, it } from "vitest";
import type { DeliveryEta } from "../lib/api";
import { finalEtaFor, mergeRouteProgress, statusFor, type RouteProgressRun, type RunProgressRecord } from "./operationsWallboardProgress";

function eta(overrides: Partial<DeliveryEta>): DeliveryEta {
  return {
    loadId: "load-1",
    loadReference: "Run 6 AM",
    loadStatus: "Planned",
    stopId: "stop-1",
    sequence: 1,
    stopName: "Collect · NWF-Selsey",
    source: "Estimated",
    risk: "Pending",
    routeDrivingMinutes: 0,
    breakMinutesIncluded: 0,
    tachoStatus: "Unavailable",
    tachoExplanation: "test",
    ...overrides,
  };
}

function progress(): RunProgressRecord {
  return {
    loadId: "load-1",
    loadReference: "Run 6 AM",
    loadStatus: "Planned",
    runState: "InProgress",
    totalStops: 4,
    completedStops: 0,
    progressPercent: 20,
    trackingFresh: true,
    trackingMoving: true,
    speedKph: 70,
    nextStop: {
      id: "stop-1",
      sequence: 1,
      name: "Collect · NWF-Selsey",
      plannedArrivalUtc: "2026-08-26T05:30:00Z",
    },
  };
}

describe("wallboard final delivery risk", () => {
  it("does not call the run late when collection is behind but final ETA is before the CSV delivery latest time", () => {
    const etas = [
      eta({ stopId: "stop-1", sequence: 1, etaUtc: "2026-08-26T06:00:00Z" }),
      eta({
        stopId: "stop-4",
        sequence: 4,
        stopName: "Deliver · Morrisons-Gadbrook",
        etaUtc: "2026-08-26T10:30:00Z",
        deliveryWindowEndUtc: "2026-08-26T17:00:00Z",
      }),
    ];

    const result = statusFor(progress(), etas[0], etas, Date.parse("2026-08-26T07:00:00Z"));

    expect(result.status).toBe("route");
    expect(result.label).toBe("ON ROUTE");
  });

  it("marks the run late only when a live final ETA is after the final delivery latest time", () => {
    const etas = [
      eta({ stopId: "stop-1", sequence: 1, etaUtc: "2026-08-26T06:00:00Z" }),
      eta({
        stopId: "stop-4",
        sequence: 4,
        stopName: "Deliver · Morrisons-Gadbrook",
        etaUtc: "2026-08-26T17:20:00Z",
        source: "Live",
        deliveryWindowEndUtc: "2026-08-26T17:00:00Z",
      }),
    ];

    const result = statusFor(progress(), etas[0], etas, Date.parse("2026-08-26T07:00:00Z"));

    expect(result.status).toBe("late");
    expect(result.label).toBe("LATE FINAL ETA");
    expect(result.detail).toContain("20m after delivery latest time");
  });

  it("keeps an approximate final ETA as risk rather than a proved late delivery", () => {
    const etas = [
      eta({ stopId: "stop-1", sequence: 1, etaUtc: "2026-08-26T06:00:00Z" }),
      eta({
        stopId: "stop-4",
        sequence: 4,
        stopName: "Deliver · Morrisons-Gadbrook",
        etaUtc: "2026-08-26T17:20:00Z",
        source: "Estimated",
        deliveryWindowEndUtc: "2026-08-26T17:00:00Z",
      }),
    ];

    const result = statusFor(progress(), etas[0], etas, Date.parse("2026-08-26T07:00:00Z"));

    expect(result.status).toBe("risk");
    expect(result.label).toBe("FINAL ETA AT RISK");
  });

  it("does not make an intermediate delivery behind plan a whole-run risk when final ETA is not yet available", () => {
    const current = progress();
    current.nextStop = {
      id: "aldi",
      sequence: 3,
      name: "Deliver · Aldi-Darlington",
      plannedArrivalUtc: "2026-08-28T10:00:00Z",
    };
    const nextEta = eta({
      stopId: "aldi",
      sequence: 3,
      stopName: "Deliver · Aldi-Darlington",
      etaUtc: "2026-08-28T10:56:00Z",
      deliveryWindowEndUtc: undefined,
    });

    const result = statusFor(current, nextEta, [], Date.parse("2026-08-28T09:45:00Z"));

    expect(result.status).toBe("route");
    expect(result.label).toBe("ON ROUTE");
  });

  it("uses the final customer destination instead of a later depot/return stop", () => {
    const destination = eta({
      stopId: "delivery",
      sequence: 4,
      stopName: "Deliver · Morrisons-Stockton",
      etaUtc: "2026-08-26T13:27:00Z",
      deliveryWindowEndUtc: "2026-08-26T14:00:00Z",
    });
    const returnStop = eta({
      stopId: "return",
      sequence: 5,
      stopName: "Return · Lake Lane",
      etaUtc: "2026-08-26T15:00:00Z",
      deliveryWindowEndUtc: undefined,
    });

    expect(finalEtaFor([destination, returnStop])?.stopId).toBe("delivery");
  });

  it("honours the final-destination marker supplied by run timing", () => {
    const markedDestination = eta({
      stopId: "destination",
      sequence: 3,
      stopName: "Customer destination",
      etaUtc: "2026-08-26T12:00:00Z",
    }) as DeliveryEta & { isFinalDestination?: boolean };
    markedDestination.isFinalDestination = true;
    const laterOperationalStop = eta({
      stopId: "later",
      sequence: 4,
      stopName: "Depot return",
      etaUtc: "2026-08-26T13:00:00Z",
    });

    expect(finalEtaFor([markedDestination, laterOperationalStop])?.stopId).toBe("destination");
  });

  it("keeps a run on route when the cumulative final ETA is before the final planned customer deadline", () => {
    const current = progress();
    current.nextStop = {
      id: "aldi",
      sequence: 3,
      name: "Deliver · Aldi-Darlington",
      plannedArrivalUtc: "2026-08-28T10:00:00Z",
    };
    const etas = [
      eta({ stopId: "aldi", sequence: 3, stopName: "Deliver · Aldi-Darlington", etaUtc: "2026-08-28T15:00:00Z" }),
      eta({ stopId: "final", sequence: 5, stopName: "Deliver · Morrisons-Stockton", etaUtc: "2026-08-28T15:29:00Z", source: "Estimated" }),
    ];

    const result = statusFor(current, etas[0], etas, Date.parse("2026-08-28T11:20:00Z"), "2026-08-28T18:00:00Z");

    expect(result.status).toBe("route");
    expect(result.label).toBe("ON ROUTE");
  });

  it("flags an estimated final ETA only after it passes the final customer deadline", () => {
    const etas = [
      eta({ stopId: "final", sequence: 5, stopName: "Deliver · Morrisons-Stockton", etaUtc: "2026-08-28T18:05:00Z", source: "Estimated" }),
    ];

    const result = statusFor(progress(), etas[0], etas, Date.parse("2026-08-28T11:20:00Z"), "2026-08-28T18:00:00Z");

    expect(result.status).toBe("risk");
    expect(result.label).toBe("FINAL ETA AT RISK");
  });

  it("does not mark a final ETA at or before the deadline as risk just for having a small buffer", () => {
    const etas = [
      eta({ stopId: "final", sequence: 5, stopName: "Deliver · Morrisons-Stockton", etaUtc: "2026-08-28T17:59:00Z", source: "Live" }),
    ];

    const result = statusFor(progress(), etas[0], etas, Date.parse("2026-08-28T11:20:00Z"), "2026-08-28T18:00:00Z");

    expect(result.status).toBe("route");
    expect(result.label).toBe("ON ROUTE");
  });


  it("does not colour the run late when only an intermediate live milestone is late", () => {
    const etas = [
      eta({ stopId: "mid", sequence: 2, stopName: "Deliver · Aldi-Darlington", etaUtc: "2026-08-28T15:00:00Z", deliveryWindowEndUtc: "2026-08-28T10:00:00Z", risk: "Late", source: "Live" }),
      eta({ stopId: "final", sequence: 5, stopName: "Deliver · Morrisons-Stockton", etaUtc: "2026-08-28T15:29:00Z", source: "Estimated" }),
    ];

    const result = statusFor(progress(), etas[0], etas, Date.parse("2026-08-28T11:20:00Z"), "2026-08-28T18:00:00Z");

    expect(result.status).toBe("route");
    expect(result.label).toBe("ON ROUTE");
  });

});


describe("wallboard durable progress merge", () => {
  it("preserves stronger departed-stop history when route progress is temporarily behind", () => {
    const durable: RunProgressRecord = {
      ...progress(),
      completedStops: 2,
      progressPercent: 55,
      nextStop: { id: "stop-3", sequence: 3, name: "Deliver · Aldi-Bolton" },
      phase: "Heading to",
      focusStop: "Deliver · Aldi-Bolton",
      stopDwell: [
        { stopId: "stop-1", sequence: 1, stopName: "Collect · NWF-Selsey", state: "Departed", siteArrivalUtc: "2026-08-28T08:00:00Z", siteDepartureUtc: "2026-08-28T08:10:00Z" },
        { stopId: "stop-2", sequence: 2, stopName: "Collect · NWF-Drayton", state: "Departed", siteArrivalUtc: "2026-08-28T09:00:00Z", siteDepartureUtc: "2026-08-28T09:10:00Z" },
      ],
    };
    const route: RouteProgressRun = {
      loadId: durable.loadId,
      reference: durable.loadReference,
      totalStops: 4,
      completedStops: 1,
      phase: "Heading to",
      truckPositionPercent: 35,
      focusStop: "Collect · NWF-Drayton",
      nextStopId: "stop-2",
      stops: [
        { id: "stop-1", sequence: 1, name: "Collect · NWF-Selsey", state: "completed" },
        { id: "stop-2", sequence: 2, name: "Collect · NWF-Drayton", state: "heading" },
        { id: "stop-3", sequence: 3, name: "Deliver · Aldi-Bolton", state: "upcoming" },
        { id: "stop-4", sequence: 4, name: "Deliver · Waitrose-Leyland", state: "upcoming" },
      ],
      stopDwell: [
        { stopId: "stop-1", sequence: 1, stopName: "Collect · NWF-Selsey", state: "Departed" },
        { stopId: "stop-2", sequence: 2, stopName: "Collect · NWF-Drayton", state: "EnRoute" },
      ],
    };

    const [merged] = mergeRouteProgress([durable], [route]);

    expect(merged.completedStops).toBe(2);
    expect(merged.nextStop?.id).toBe("stop-3");
    expect(merged.focusStop).toBe("Deliver · Aldi-Bolton");
    expect(merged.stopDwell?.find(stop => stop.stopId === "stop-2")?.state).toBe("Departed");
  });

  it("adopts route progress when it contains stronger geofence evidence", () => {
    const durable: RunProgressRecord = {
      ...progress(),
      completedStops: 1,
      nextStop: { id: "stop-2", sequence: 2, name: "Collect · NWF-Drayton" },
      stopDwell: [{ stopId: "stop-1", sequence: 1, stopName: "Collect · NWF-Selsey", state: "Departed" }],
    };
    const route: RouteProgressRun = {
      loadId: durable.loadId,
      reference: durable.loadReference,
      totalStops: 4,
      completedStops: 2,
      phase: "Heading to",
      truckPositionPercent: 60,
      focusStop: "Deliver · Aldi-Bolton",
      nextStopId: "stop-3",
      stops: [
        { id: "stop-1", sequence: 1, name: "Collect · NWF-Selsey", state: "completed" },
        { id: "stop-2", sequence: 2, name: "Collect · NWF-Drayton", state: "completed" },
        { id: "stop-3", sequence: 3, name: "Deliver · Aldi-Bolton", state: "heading" },
        { id: "stop-4", sequence: 4, name: "Deliver · Waitrose-Leyland", state: "upcoming" },
      ],
      stopDwell: [
        { stopId: "stop-1", sequence: 1, stopName: "Collect · NWF-Selsey", state: "Departed" },
        { stopId: "stop-2", sequence: 2, stopName: "Collect · NWF-Drayton", state: "Departed" },
      ],
    };

    const [merged] = mergeRouteProgress([durable], [route]);

    expect(merged.completedStops).toBe(2);
    expect(merged.nextStop?.id).toBe("stop-3");
    expect(merged.focusStop).toBe("Deliver · Aldi-Bolton");
  });
});
