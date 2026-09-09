import { describe, expect, it } from "vitest";
import { lyonsCollectionPlanRowsToCsv } from "./lyonsCollectionsWorkbook";
import { parsePlannerCsv } from "./plannerCsvImport";

const rows = [
  ["2026-09-07T17:32:45.630Z", null, null, null, "ON"],
  [-0.26, null, null, null, "Collection Date:", 46273],
  [],
  [null, "Load Number", "Collection Site", "Delivery Destination", "Pallets  Ordered", "Driver", "Vehicle", "Trailer", "Notes", "Planned Collect Time From", "Planned Collect Time To", "Deadline Time", "Collection Site Arr Date", "Collection Site Arr Time", "Despatched Date", "Despatched Time", "Delivered Date"],
  [100, 1, "GHS-Greenhouse Growers (Eric Wall)", "Aldi-Darlington", 2, "John Hackney", "XDL", "70", "Kieran PRELOAD", 17 / 24, 18 / 24, 18 / 24, 46272, null, 46273, null, 46273],
  [100, 1, "NWF-Selsey", "Aldi-Darlington", 16, "John Hackney", "XDL", "70", null, 5 / 24, 6 / 24, 18 / 24, 46273, null, 46273, null, 46273],
  [0, null, null, null, null],
  [100, 2, "NWF-Merston", "Aldi-Goldthorpe", 0, "Ben Madge", "CVP", "56", null, 6 / 24, 7 / 24, 18 / 24, 46273, null, 46273, null, 46273],
] as const;

describe("Lyons Collections workbook parser", () => {
  it("recognises the real Collection Plan header below metadata and preserves pre-collections", () => {
    const csv = lyonsCollectionPlanRowsToCsv(rows.map(row => [...row]), "Lyons collections 080926.xlsm · Collection Plan");
    const payload = parsePlannerCsv(csv, "Lyons collections 080926.xlsm · Collection Plan");

    expect(payload.planningDate).toBe("2026-09-08");
    expect(payload.runs).toHaveLength(1);
    expect(payload.runs[0].plannerRun).toBe("Run 1");
    expect(payload.runs[0].driver).toBe("John Hackney");
    expect(payload.runs[0].vehicle).toBe("XDL");
    expect(payload.runs[0].trailer).toBe("70");
    expect(payload.runs[0].stops).toHaveLength(2);
    expect(payload.runs[0].stops[0]).toMatchObject({
      collectionSite: "GHS-Greenhouse Growers (Eric Wall)",
      deliverySite: "Aldi-Darlington",
      pallets: 2,
      collectionDate: "2026-09-07",
      collectFrom: "17:00",
    });
    expect(payload.runs[0].stops[1]).toMatchObject({
      collectionSite: "NWF-Selsey",
      deliverySite: "Aldi-Darlington",
      pallets: 16,
      collectionDate: "2026-09-08",
      collectFrom: "05:00",
    });
    expect(payload.runs[0].plannerNote).toContain("Pre-collection(s): 2026-09-07 17:00 GHS-Greenhouse Growers (Eric Wall)");
  });

  it("drops separators and zero-pallet worksheet rows so they cannot become demand", () => {
    const csv = lyonsCollectionPlanRowsToCsv(rows.map(row => [...row]));
    expect(csv).not.toContain("NWF-Merston,Aldi-Goldthorpe,0");
    expect(csv.split("\n")).toHaveLength(3);
  });
});
