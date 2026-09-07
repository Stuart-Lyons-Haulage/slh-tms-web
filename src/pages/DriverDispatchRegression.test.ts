import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DriverDispatch.tsx", import.meta.url), "utf8");

describe("Driver Dispatch UI contract", () => {
  it("keeps dispatch statuses visible with planner-friendly labels", () => {
    expect(source).toContain("<th>Status</th>");
    expect(source).toContain("No Run");
    expect(source).toContain("Awaiting Dispatch");
    expect(source).toContain("Sent Awaiting Response");
    expect(source).toContain("Confirmed");
    expect(source).toContain('"Awaiting confirmation"');
    expect(source).toContain('"Ready to dispatch"');
    expect(source).not.toContain("<th>Start</th>");
  });

  it("shows a compact built-run pool before the driver allocation table", () => {
    expect(source).toContain("data-testid=\"built-runs-queue\"");
    expect(source).toContain("Runs ready to allocate");
    expect(source).toContain("built-run-chip");
    expect(source.indexOf("<BuiltRunsQueue loads={data.loads} />")).toBeLessThan(source.indexOf("dispatch-table-wrap"));
  });

  it("uses RUN number, AM or PM and final destination as the visible run summary", () => {
    expect(source).toContain('return load ? `RUN ${runNumber(load)}` : "—"');
    expect(source).toContain('return date.getHours() < 12 ? "AM" : "PM"');
    expect(source).toContain('`${compactRun(load)} · ${runPeriod(load)} · ${finalDestination(load)}`');
    expect(source).toContain("routeTitle(load)");
    expect(source).toContain("run-popover");
  });

  it("opens allocation fields before saving instead of allocating immediately", () => {
    expect(source).toContain("const [editingAllocation, setEditingAllocation] = useState(false)");
    expect(source).toContain("function beginAllocation()");
    expect(source).toContain("setEditingAllocation(true)");
    expect(source).toContain("Choose the run, vehicle and trailer, then Save allocation.");
    expect(source).toContain('editingAllocation ? <TypeaheadSelect');
    expect(source).toContain('driver.assignedLoadId ? "Edit allocation" : "Allocate"');
  });

  it("keeps selected details through save and then returns to ready-to-dispatch state", () => {
    expect(source).toContain("saved.driverId !== driver.driverId");
    expect(source).toContain("saved.vehicleId !== vehicleId");
    expect(source).toContain('(saved.trailerId || "") !== trailerId');
    expect(source).toContain("setEditingAllocation(false)");
    expect(source).toContain("Allocation saved. Ready to dispatch.");
    expect(source).toContain('driver.assignedLoadId === selected.id && effectiveStatus === "Awaiting Dispatch"');
  });

  it("derives the dispatch message start from the first planned collection", () => {
    expect(source).toContain("firstCollectionStop(latest)?.plannedArrivalUtc || latest.plannedStartUtc");
    expect(source).not.toContain("/start-time");
  });
});
