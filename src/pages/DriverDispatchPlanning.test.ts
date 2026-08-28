import { describe, expect, it } from "vitest";
import { firstCollectionStop, runDirection, suggestionRunLabel } from "./DriverDispatch";

function load(overrides: Record<string, unknown> = {}) {
  return {
    id: "load-1",
    reference: "Run 2 PM",
    rawReference: "PLAN-20260828-2",
    planningDate: "2026-08-28",
    status: "Draft",
    southbound: false,
    stops: [
      { id: "c", sequence: 1, name: "Collect · NWF-Runcton", latitude: 50.8, longitude: -0.7, plannedArrivalUtc: "2026-08-28T05:00:00Z" },
      { id: "d", sequence: 2, name: "Deliver · Aldi-Stockton", latitude: 54.57, longitude: -1.31, plannedArrivalUtc: "2026-08-28T10:00:00Z" },
    ],
    ...overrides,
  } as Parameters<typeof suggestionRunLabel>[0];
}

describe("Driver Dispatch planning helpers", () => {
  it("labels an assistant run with its final destination", () => {
    expect(suggestionRunLabel(load())).toBe("Run 2 Aldi Stockton");
  });

  it("groups a run travelling materially north as Northern", () => {
    expect(runDirection(load())).toBe("Northern");
  });

  it("uses the first collection stop rather than a later delivery", () => {
    expect(firstCollectionStop(load())?.name).toBe("Collect · NWF-Runcton");
  });
});
