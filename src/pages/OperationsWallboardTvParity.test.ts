import { describe, expect, it } from "vitest";
import wallboard from "./OperationsWallboard.tsx?raw";
import live from "./OperationsWallboardLive.tsx?raw";
import linkage from "./RunGeofenceLinkagePanel.tsx?raw";

describe("Operations wallboard TV parity", () => {
  it("renders the same per-run geofence linkage strip on a paired TV", () => {
    expect(wallboard).toContain("<RunGeofenceLinkagePanel />");
    expect(linkage).toContain('"X-TV-Display-Key": tvAccessKey');
    expect(linkage).toContain("Geofences {run.linked}/{run.stops.length} linked");
    expect(linkage).toContain("{run.hits} hit");
  });

  it("prints the final-customer deadline buffer beside final-customer status", () => {
    expect(live).toContain("const buffer = minutesToWindow(row.finalEta);");
    expect(live).not.toContain("const buffer = minutesToWindow(row.nextEta);");
    expect(live).toContain("Final ETA targets final customer destination");
  });

  it("keeps the wallboard and paired TV on the shared live component", () => {
    expect(wallboard).toContain("<ExistingOperationsWallboard tvMode={tvMode} tvAccessKey={tvAccessKey} />");
    expect(live).toContain('className="ops-wallboard');
  });
});
