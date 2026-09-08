import { describe, expect, it } from "vitest";
import type { PlannerCsvPayload } from "./plannerCsvImport";
import { plannerPayloadToBetaComparison } from "./betaOptimiser";

describe("plannerPayloadToBetaComparison", () => {
  it("keeps all collections ahead of linked deliveries for each planner run", () => {
    const payload: PlannerCsvPayload = {
      schema: "slh-planner-plan-v1",
      planningDate: "2026-09-09",
      exceptions: [],
      runs: [{
        runRef: "LYONS-20260909-RUN-001",
        plannerRun: "Run 1",
        planningDate: "2026-09-09",
        includeInImport: true,
        reconciliationStatus: "CSV direct import",
        capacityStatus: "Green",
        mixedUtilisationPercent: 50,
        stops: [
          { sequence: 1, collectionSite: "NWF Drayton", deliverySite: "Darlington", sourceRow: 2 },
          { sequence: 2, collectionSite: "Runcton", deliverySite: "Leeds", sourceRow: 3 }
        ]
      }]
    };

    const request = plannerPayloadToBetaComparison(payload);

    expect(request.planningDate).toBe("2026-09-09");
    expect(request.routes).toHaveLength(1);
    expect(request.routes[0].reference).toBe("Run 1");
    expect(request.routes[0].stops).toEqual([
      { name: "NWF Drayton", orderKey: "2" },
      { name: "Runcton", orderKey: "3" },
      { name: "Darlington", orderKey: "2" },
      { name: "Leeds", orderKey: "3" }
    ]);
  });
});
