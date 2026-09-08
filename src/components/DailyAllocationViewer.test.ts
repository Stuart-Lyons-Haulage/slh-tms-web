import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DailyAllocationViewer.tsx", import.meta.url), "utf8");

describe("Dashboard Driver Dispatch mirror", () => {
  it("reads the same workbench and status sources as Driver Dispatch", () => {
    expect(source).toContain('/api/v1/driver-dispatch?date=');
    expect(source).toContain('/api/v1/driver-dispatch-status?date=');
    expect(source).not.toContain('driverAssignments(');
  });

  it("is read-only and mirrors the operational Dispatch columns", () => {
    for (const heading of ["Driver", "Type / skills", "Code", "Day", "Vehicle", "Trailer", "Run", "Assistant", "Status"]) {
      expect(source).toContain(`<th>${heading}</th>`);
    }
    expect(source).toContain("Read-only Driver Dispatch mirror");
    expect(source).not.toContain("Allocate</button>");
    expect(source).not.toContain("Save allocation</button>");
  });

  it("keeps allocated rows consistent when the persisted status still says No Run", () => {
    expect(source).toContain('if (assigned && status?.dispatchStatus === "No Run") return "Awaiting Dispatch"');
  });
});
