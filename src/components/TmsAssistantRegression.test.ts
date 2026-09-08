import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TmsAssistant.tsx", import.meta.url), "utf8");

describe("SLH Assistant navigation contract", () => {
  it("routes incomplete driver or vehicle allocations to Driver Dispatch", () => {
    expect(source).toContain('item.id === "loads-unallocated"');
    expect(source).toContain('path: "/driver-dispatch", label: "Driver Dispatch"');
    expect(source).toContain('Dispatch: "/driver-dispatch"');
  });

  it("keeps genuine planning suggestions on Planner", () => {
    expect(source).toContain('Planner: "/"');
  });
});
