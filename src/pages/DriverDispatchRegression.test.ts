import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DriverDispatch.tsx", import.meta.url), "utf8");

describe("Driver Dispatch UI contract", () => {
  it("keeps status visible and removes the manual Start column", () => {
    expect(source).toContain("<th>Status</th>");
    expect(source).toContain("No Run");
    expect(source).toContain("Awaiting Dispatch");
    expect(source).toContain("Sent Awaiting Response");
    expect(source).toContain("Confirmed");
    expect(source).not.toContain("<th>Start</th>");
    expect(source).not.toContain("<input type=\"time\"");
  });

  it("shows the built run pool before the driver allocation table", () => {
    expect(source).toContain("data-testid=\"built-runs-queue\"");
    expect(source).toContain("Built runs ready to allocate");
    expect(source.indexOf("<BuiltRunsQueue loads={data.loads} />")).toBeLessThan(source.indexOf("dispatch-table-wrap"));
  });

  it("does not leave a selected run stuck behind No Run", () => {
    expect(source).toContain('selected && persistedStatus === "No Run" ? "Awaiting Dispatch"');
    expect(source).toContain('driver.assignedLoadId === selected.id ? "Save allocation" : "Allocate"');
    expect(source).toContain("Allocation saved. Run is ready for dispatch.");
  });

  it("verifies the allocation response contains the selected resources", () => {
    expect(source).toContain("saved.driverId !== driver.driverId");
    expect(source).toContain("saved.vehicleId !== vehicleId");
    expect(source).toContain('(saved.trailerId || "") !== trailerId');
  });

  it("derives the dispatch message start from the first planned collection", () => {
    expect(source).toContain("firstCollectionStop(latest)?.plannedArrivalUtc || latest.plannedStartUtc");
    expect(source).not.toContain("/start-time");
  });
});
