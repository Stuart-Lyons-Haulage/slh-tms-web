import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./OperationsIntelligence.tsx", import.meta.url), "utf8");

describe("Operations attention UI contract", () => {
  it("hides generic unmapped-stop exceptions while retaining geofence attention items", () => {
    expect(source).toContain("x.type !== 'MissingGeocode'");
    expect(source).toContain("visibleItems.length");
    expect(source).toContain("visibleItems.map(item");
    expect(source).not.toContain("report.data.items.map(item");
  });
});
