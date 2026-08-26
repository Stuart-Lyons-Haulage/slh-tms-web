import { describe, expect, it } from "vitest";
import type { DeliveryEta } from "../lib/api";
import { statusFor, type RunProgressRecord } from "./operationsWallboardProgress";

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
});
