import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import wallboard from "./OperationsWallboard.tsx?raw";
import live from "./OperationsWallboardLive.tsx?raw";
import linkage from "./RunGeofenceLinkagePanel.tsx?raw";

const css = readFileSync(new URL("../operations-wallboard.css", import.meta.url), "utf8");
const physicalTv = readFileSync(new URL("../../public/tv-wallboard-v4.js", import.meta.url), "utf8");

describe("Operations wallboard TV parity", () => {
  it("renders the same per-run geofence linkage strip on a paired TV", () => {
    expect(wallboard).toContain("{!tvMode && <RunGeofenceLinkagePanel />}");
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

  it("keeps the physical Hisense board on the same live progress and timing sources as the signed-in TMS", () => {
    expect(readFileSync(new URL("../../public/tv.html", import.meta.url), "utf8")).toContain("/tv-wallboard-v4.js");
    expect(physicalTv).toContain("/api/v1/tv-display/wallboard-proxy/run-progress");
    expect(physicalTv).toContain("/api/v1/tv-display/route-progress");
    expect(physicalTv).toContain("/api/v1/tv-display/wallboard-proxy/delivery-etas");
    expect(physicalTv).toContain("/api/v1/run-timing");
    expect(physicalTv).toContain("/api/v1/driver-assignments");
    expect(physicalTv).toContain("Math.max(Number(base.completedStops || 0), Number(route.completedStops || 0))");
    expect(physicalTv).toContain("finalArrivalUtc(progress, timing, load)");
    expect(physicalTv).toContain("var ROTATE_MS = 60 * 1000");
    expect(physicalTv).toContain("var REFRESH_MS = 5 * 60 * 1000");
    expect(physicalTv).not.toContain("HARD_RELOAD_MS");
    expect(physicalTv).toContain("dispatch allocation");
  });
});
