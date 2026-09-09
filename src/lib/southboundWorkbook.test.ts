import { describe, expect, it } from "vitest";
import { isLyonsSouthboundWorkbook, southboundWorkbookToPayload, type WorkbookSheetRows } from "./southboundWorkbook";

function sheets(): WorkbookSheetRows {
  const southbound: unknown[][] = [];
  southbound[0] = [null, null, null, null, null, null, "DATE:", new Date("2026-09-09T00:00:00Z")];
  southbound[3] = ["SOUTHBOUNDS"];
  southbound[5] = ["S1", "Bedford", "Merston / Runcton", "228324793", new Date("2026-09-10T00:00:00Z"), 6 / 24, "Merston 18 plt / Rncton 15 plt", "Driver One"];
  southbound[6] = ["S2", "Bedford", "Selsey", "228325084", new Date("2026-09-10T00:00:00Z"), 7 / 24, "", "Driver Two"];
  southbound[7] = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "T7", "Ham Farm to Walton Farm crate transfer AM", "Driver Three"];

  const board: unknown[][] = [];
  board[3] = [null, "Yes", "Barfoots Sefter Market", 10, "Night Driver", "Night collection"];
  board[4] = [null, "Yes", "APS Waitrose Wave 3", 4, "", ""];

  const wave3: unknown[][] = [];
  wave3[1] = ["Bracknell", null, null, null, null, "Brinklow", null, null, null, null, "Aylesford", null, null, null, null, "Leyland"];
  wave3[3] = ["Barfoots", "K78691", null, null, null, "APS", "K78679", null, null, null, "Hill Brothers", "J59550", null, null, null, "Barfoots", "B78749"];
  wave3[18] = ["Bracknell Chill", null, null, null, null, "Brinklow Chill", null, null, null, null, "Aylesford Chill", null, null, null, null, "Leyland Chill"];
  wave3[20] = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "Barfoots", "A63320"];

  const staleCovent: unknown[][] = [];
  staleCovent[2] = ["Covent Garden"];
  staleCovent[4] = [new Date("2026-09-08T00:00:00Z")];
  staleCovent[7] = ["Stall 1", 3, "Barfoots"];

  return {
    Southbound: southbound,
    "Collection Board": board,
    "WAVE 3": wave3,
    "Covent Garden": staleCovent,
  } as WorkbookSheetRows;
}

describe("Southbound workbook parser", () => {
  it("recognises the real H1 date and tolerates the live Rncton typo when splitting allocations", () => {
    const workbook = sheets();
    expect(isLyonsSouthboundWorkbook(workbook)).toBe(true);
    const payload = southboundWorkbookToPayload(workbook, "New Southbound Sheet - 09.09.26.xlsm");

    expect(payload.planningDate).toBe("2026-09-09");
    const s1 = payload.runs.find(run => run.plannerRun === "Run S1");
    expect(s1?.stops).toHaveLength(2);
    expect(s1?.stops[0]).toMatchObject({ collectionSite: "Bedford", deliverySite: "Merston", pallets: 18, reference: "228324793" });
    expect(s1?.stops[1]).toMatchObject({ collectionSite: "Bedford", deliverySite: "Runcton", pallets: 15, reference: "228324793" });
  });

  it("retains jobs, transfers and all four Wave 3 destinations when pallet quantity is not stated", () => {
    const payload = southboundWorkbookToPayload(sheets(), "New Southbound Sheet - 09.09.26.xlsm");
    const s2 = payload.runs.find(run => run.plannerRun === "Run S2");
    const t7 = payload.runs.find(run => run.plannerRun === "Run T7");
    const bracknell = payload.runs.find(run => run.plannerRun.includes("W3-0-4-K78691"));
    const leyland = payload.runs.find(run => run.plannerRun.includes("W3-15-4-B78749"));
    const leylandChill = payload.runs.find(run => run.plannerRun.includes("W3-15-21-A63320"));

    expect(s2?.stops[0]).toMatchObject({ collectionSite: "Bedford", deliverySite: "Selsey", pallets: 0 });
    expect(t7?.stops[0]).toMatchObject({ collectionSite: "Ham Farm", deliverySite: "Walton Farm", pallets: 0, palletType: "Crates" });
    expect(bracknell?.stops[0]).toMatchObject({ collectionSite: "Barfoots", deliverySite: "Waitrose Bracknell", pallets: 0, reference: "K78691" });
    expect(leyland?.stops[0]).toMatchObject({ collectionSite: "Barfoots", deliverySite: "Waitrose Leyland", pallets: 0, reference: "B78749" });
    expect(leylandChill?.stops[0]).toMatchObject({ collectionSite: "Barfoots", deliverySite: "Waitrose Leyland Chill", pallets: 0, reference: "A63320" });
  });

  it("does not import stale market-detail tabs and retains current Collection Board market demand for review", () => {
    const payload = southboundWorkbookToPayload(sheets(), "New Southbound Sheet - 09.09.26.xlsm");
    expect(payload.exceptions.some(exception => exception.code === "StaleMarketSheetIgnored")).toBe(true);
    expect(payload.runs.some(run => run.plannerRun === "Run MARKET-BOARD-4")).toBe(true);
    expect(payload.exceptions.some(exception => exception.code === "MarketDestinationNeedsReview")).toBe(true);
    expect(payload.runs.some(run => run.stops.some(stop => stop.deliverySite === "Covent Garden"))).toBe(false);
  });
});
