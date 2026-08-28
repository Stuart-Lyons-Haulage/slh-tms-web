import { describe, expect, it } from "vitest";
import app from "./App.tsx?raw";
import optimiser from "./components/OptimiserProposalReview.tsx?raw";
import control from "./pages/ControlCentre.tsx?raw";
import dashboard from "./pages/DashboardOperational.tsx?raw";
import imports from "./pages/ImportCentre.tsx?raw";
import master from "./pages/MasterDataHub.tsx?raw";
import review from "./pages/OrderReviewBulk.tsx?raw";
import palletControl from "./pages/PalletPlanningControl.tsx?raw";
import planner from "./pages/PlannerEnhanced.tsx?raw";
import runBuilder from "./pages/RunPlannerLive.tsx?raw";

describe("operations housekeeping contract", () => {
  it("keeps Planner focused on planning only", () => {
    expect(planner).not.toContain("SubcontractorQuickAdd");
    expect(planner).not.toContain("Automatic order intake");
    expect(planner).not.toContain("review-orders-link");
    expect(planner).toContain("Open Pallet Control");
  });

  it("removes pallet utilisation from the mixed-unit run builder and gives optimiser more time", () => {
    expect(runBuilder).not.toContain("/ 26 pallets");
    expect(runBuilder).not.toContain("simple-run-pallets");
    expect(optimiser).toContain("180000");
  });

  it("makes order history navigable beyond the fixed eleven-day strip", () => {
    expect(review).toContain("Jump to date");
    expect(review).toContain("pendingOrderDates");
  });

  it("keeps Pallet Control as three stacked live boards", () => {
    expect(app).toContain("['/pallet-control', 'Pallet Control']");
    expect(palletControl).toContain('matrix("toPlan", "To Plan"');
    expect(palletControl).toContain('matrix("planned", "Planned"');
    expect(palletControl).toContain('matrix("summary", "Pallet Summary"');
    expect(palletControl).toContain("data.summary.ordered");
    expect(palletControl).toContain("pallet-control-stack");
    expect(palletControl).toContain("2000");
    expect(palletControl).toContain("Trays / Crates");
    expect(palletControl).toContain("Trolleys");
    expect(palletControl).not.toContain("Current orders");
  });

  it("removes destructive master uploads and keeps a CSV contingency import", () => {
    expect(master).not.toContain("MasterDataResetImportPanel");
    expect(master).not.toContain("MasterDataUploadSmall");
    expect(imports).toContain("Master data CSV");
  });

  it("puts Imports last in navigation and makes Control Centre one page", () => {
    expect(app).toContain('title="Imports"');
    expect(control).not.toContain("useState");
    expect(control).toContain("OperationsControlClean");
    expect(control).toContain("AdminIntegrationSyncControls");
  });

  it("expands Dashboard into health, attention and feed freshness", () => {
    expect(dashboard).toContain("Today's attention");
    expect(dashboard).toContain("System feeds");
    expect(dashboard).toContain("Operational health");
  });
});
