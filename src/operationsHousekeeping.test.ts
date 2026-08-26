import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("operations housekeeping contract", () => {
  it("keeps Planner focused on planning only", () => {
    const planner = source("./pages/PlannerEnhanced.tsx");
    expect(planner).not.toContain("SubcontractorQuickAdd");
    expect(planner).not.toContain("Automatic order intake");
    expect(planner).not.toContain("review-orders-link");
  });

  it("removes pallet utilisation from the mixed-unit run builder and gives optimiser more time", () => {
    const runBuilder = source("./pages/RunPlannerLive.tsx");
    const optimiser = source("./components/OptimiserProposalReview.tsx");
    expect(runBuilder).not.toContain("/ 26 pallets");
    expect(runBuilder).not.toContain("simple-run-pallets");
    expect(optimiser).toContain("180000");
  });

  it("makes order history navigable beyond the fixed eleven-day strip", () => {
    const review = source("./pages/OrderReviewBulk.tsx");
    expect(review).toContain("Jump to date");
    expect(review).toContain("pendingOrderDates");
  });

  it("shows Pallet Control as one compact To plan and Planned screen", () => {
    const palletControl = source("./pages/PalletPlanningControl.tsx");
    expect(palletControl).toContain("To plan");
    expect(palletControl).toContain("pallet-control-columns");
    expect(palletControl).not.toContain("Current orders");
  });

  it("removes destructive master uploads and keeps a CSV contingency import", () => {
    const master = source("./pages/MasterDataHub.tsx");
    const imports = source("./pages/ImportCentre.tsx");
    expect(master).not.toContain("MasterDataResetImportPanel");
    expect(master).not.toContain("MasterDataUploadSmall");
    expect(imports).toContain("Master data CSV");
  });

  it("puts Imports last in navigation and makes Control Centre one page", () => {
    const app = source("./App.tsx");
    const control = source("./pages/ControlCentre.tsx");
    expect(app).toContain('title="Imports"');
    expect(control).not.toContain("useState");
    expect(control).toContain("OperationsControlClean");
    expect(control).toContain("AdminIntegrationSyncControls");
  });

  it("expands Dashboard into health, attention and feed freshness", () => {
    const dashboard = source("./pages/DashboardOperational.tsx");
    expect(dashboard).toContain("Today's attention");
    expect(dashboard).toContain("System feeds");
    expect(dashboard).toContain("Operational health");
  });
});
