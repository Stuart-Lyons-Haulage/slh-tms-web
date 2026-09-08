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

  it("shows only unallocated runs in the pool above the driver table", () => {
    expect(source).toContain("data-testid=\"built-runs-queue\"");
    expect(source).toContain("Built runs ready to allocate");
    expect(source).toContain("filter(load => !load.driverId)");
    expect(source.indexOf("<BuiltRunsQueue loads={data.loads} />")).toBeLessThan(source.indexOf("dispatch-table-wrap"));
  });

  it("keeps a successful allocation visible against the driver instead of refreshing it away", () => {
    expect(source).toContain("const applySavedAllocation = useCallback");
    expect(source).toContain("assignedLoadId: saved.id");
    expect(source).toContain("applySavedAllocation(saved, driver.driverId, previous?.id)");
    expect(source).toContain("Run remains against this driver and is ready to dispatch");
    const saveStart = source.indexOf("async function save()");
    const dispatchStart = source.indexOf("async function prepareDispatch()", saveStart);
    expect(source.slice(saveStart, dispatchStart)).not.toContain("await refresh()");
  });

  it("makes the Dispatch action available from the locally committed allocation", () => {
    expect(source).toContain('dispatchStatus: "Awaiting Dispatch"');
    expect(source).toContain('driver.assignedLoadId === selected.id && effectiveStatus === "Awaiting Dispatch"');
    expect(source).toContain('onClick={() => void prepareDispatch()}');
    expect(source).toContain('{busy ? "Preparing…" : "Dispatch"}</button>');
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