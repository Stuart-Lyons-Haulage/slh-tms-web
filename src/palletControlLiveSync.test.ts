import { describe, expect, it } from "vitest";
import palletControl from "./pages/PalletPlanningControl.tsx?raw";

describe("Pallet Control live sync", () => {
  it("uses the shared planning change bus for immediate cross-tab refresh", () => {
    expect(palletControl).toContain('import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";');
    expect(palletControl).toContain("subscribePlanningChanges(refreshControl)");
    expect(palletControl).toContain("signalPlanningChange();");
    expect(palletControl).not.toContain('const PLANNING_CHANNEL = "slh-planning-control"');
    expect(palletControl).not.toContain('const PLANNING_STORAGE_KEY = "slh:planning-control-changed"');
  });

  it("keeps the two-second live loop and save reconciliation on pallet data only", () => {
    expect(palletControl).toContain('window.setInterval(() => { if (document.visibilityState === "visible") void refreshControl(); }, 2000)');
    expect(palletControl).not.toContain("await Promise.all([refreshControl(), refreshRegions()])");
    expect(palletControl).toContain('onClick={() => { void refreshControl(); void refreshRegions(); }}');
  });
});
