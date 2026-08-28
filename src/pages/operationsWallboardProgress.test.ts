import { describe, expect, it } from "vitest";
import type { DeliveryEta } from "../lib/api";
import { finalEtaFor, statusFor, type RunProgressRecord } from "./operationsWallboardProgress";

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

  it("uses delivery wording when the next milestone is an intermediate delivery", () => {
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

    expect(result.label).toBe("DELIVERY BEHIND");
    expect(result.detail).toContain("final customer delivery ETA assessed separately");
    expect(result.detail).not.toContain("collection plan");
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
});
