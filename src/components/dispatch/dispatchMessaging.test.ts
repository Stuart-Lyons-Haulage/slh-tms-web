import { describe, expect, it } from "vitest";
import { buildDispatchText, dispatchActionForStatus } from "./dispatchMessaging";

const dispatch = {
  driver: { displayName: "Dan Driver" },
  vehicle: { registration: "AB12 CDE" },
  trailer: { trailerNumber: "TRL-01" },
  stops: [
    {
      sequence: 1,
      name: "Collect · Runcton",
      address: "Runcton, Chichester",
      order: { reference: "PO-123" }
    },
    {
      sequence: 2,
      name: "Deliver · Birmingham Market",
      address: "Birmingham",
      order: { marketName: "Birmingham Wholesale Market", stallNumber: "A12", driverInstructions: "Call on arrival" }
    }
  ]
};

describe("authoritative Smart Dispatch messaging", () => {
  it("only exposes Dispatch once the selected run is locked to that driver", () => {
    expect(dispatchActionForStatus(false, "No Run")).toBe("allocate");
    expect(dispatchActionForStatus(true, "Awaiting Dispatch")).toBe("dispatch");
    expect(dispatchActionForStatus(true, "Sent Awaiting Response")).toBe("amend");
    expect(dispatchActionForStatus(true, "Confirmed")).toBe("amend");
  });

  it("builds the editable driver text with route, reference and market detail", () => {
    const text = buildDispatchText("Run 4 PM", dispatch, "17:30");
    expect(text).toContain("SLH Run 4 PM");
    expect(text).toContain("Driver: Dan Driver");
    expect(text).toContain("Planned start: 17:30");
    expect(text).toContain("Vehicle: AB12 CDE");
    expect(text).toContain("Trailer: TRL-01");
    expect(text).toContain("Ref: PO-123");
    expect(text).toContain("Market: Birmingham Wholesale Market · Stall A12");
    expect(text).toContain("Notes: Call on arrival");
    expect(text).toContain("Please reply to confirm receipt.");
  });
});
