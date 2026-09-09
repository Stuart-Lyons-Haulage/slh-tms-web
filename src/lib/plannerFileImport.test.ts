import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parsePlannerPlanFile } from "./plannerFileImport";

const rows = [
  ["Load number", "Collection", "Delivery", "Pallets", "Planned dispatch date", "PO"],
  ["1", "Runcton", "Leeds", "9", "09/09/2026", "PO-7788"],
];

function workbookFile(name = "Lyons Collections.xlsx") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Notes"], ["Not the planner sheet"]]), "Cover");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Collections");
  const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return {
    name,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    arrayBuffer: async () => data as ArrayBuffer,
    text: async () => "",
  } as File;
}

describe("parsePlannerPlanFile", () => {
  it("finds the Lyons planner sheet inside a normal Excel workbook", async () => {
    const payload = await parsePlannerPlanFile(workbookFile());
    expect(payload.planningDate).toBe("2026-09-09");
    expect(payload.runs).toHaveLength(1);
    expect(payload.runs[0].plannerRun).toBe("Run 1");
    expect(payload.runs[0].stops[0]).toMatchObject({
      collectionSite: "Runcton",
      deliverySite: "Leeds",
      pallets: 9,
      reference: "PO-7788",
    });
  });
});
