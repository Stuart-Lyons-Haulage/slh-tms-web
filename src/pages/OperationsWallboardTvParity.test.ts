import { describe, expect, it } from "vitest";
import wallboard from "./OperationsWallboard.tsx?raw";
import live from "./OperationsWallboardLive.tsx?raw";
import linkage from "./RunGeofenceLinkagePanel.tsx?raw";
import css from "../operations-wallboard.css?raw";

describe("Operations wallboard TV parity", () => {
  it("renders the same per-run geofence linkage strip on a paired TV", () => {
    expect(wallboard).toContain("<RunGeofenceLinkagePanel tvAccessKey={tvMode ? tvAccessKey : undefined} />");
    expect(linkage).toContain('"X-TV-Display-Key": tvAccessKey');
    expect(linkage).toContain("Geofences {run.linked}/{run.stops.length} linked");
    expect(linkage).toContain("{run.hits} hit");
  });

  it("prints the final-customer deadline buffer beside final-customer status", () => {
    expect(live).toContain("const buffer = minutesToWindow(row.finalEta);");
    expect(live).not.toContain("const buffer = minutesToWindow(row.nextEta);");
    expect(live).toContain("Final customer ETA/deadline drives run risk");
  });

  it("keeps the six summary cards and TV table inside the fixed viewport", () => {
    expect(css).toContain("grid-template-columns: repeat(6, minmax(0, 1fr));");
    expect(css).toContain("height: 100dvh;");
    expect(css).toContain(".ops-wallboard.tv .ops-board-head");
    expect(css).toContain("min-width: 0;");
    expect(css).toContain("overflow-x: hidden;");
  });
});
