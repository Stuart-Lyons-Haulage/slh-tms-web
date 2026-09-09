import { parsePlannerCsv, type PlannerCsvPayload } from "./plannerCsvImport";
import { isLyonsCollectionPlanRows, lyonsCollectionPlanRowsToCsv, type WorkbookRows } from "./lyonsCollectionsWorkbook";
import { isLyonsSouthboundWorkbook, southboundWorkbookToPayload, type WorkbookSheetRows } from "./southboundWorkbook";

const workbookExtension = /\.(xlsx|xls|xlsm)$/i;

export async function parsePlannerPlanFile(file: File): Promise<PlannerCsvPayload> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    return parsePlannerCsv(await file.text(), file.name);
  }

  if (!workbookExtension.test(file.name)) {
    throw new Error("Lyons plan format not recognised. Upload the usual CSV, XLSX, XLS or XLSM file.");
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: true });

  // The Lyons Collections workbook contains many supplier/helper sheets. Only
  // Collection Plan is the planner's built run sheet and may become human-plan
  // evidence. Never fall through into Pallet Order, supplier dumps or Master Data.
  const collectionPlanSheet = workbook.Sheets["Collection Plan"];
  if (collectionPlanSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(collectionPlanSheet, { header: 1, defval: null, raw: true }) as WorkbookRows;
    if (!isLyonsCollectionPlanRows(rows)) {
      throw new Error(`${file.name} contains a Collection Plan sheet, but its live run-sheet columns were not recognised.`);
    }
    const canonicalCsv = lyonsCollectionPlanRowsToCsv(rows, `${file.name} · Collection Plan`);
    return parsePlannerCsv(canonicalCsv, `${file.name} · Collection Plan`);
  }

  // Southbound is intentionally a multi-sheet operational workbook: its main
  // board, WAVE 3, Collection Board and current market tabs are complementary.
  // Load all sheets only for this format.
  if (workbook.Sheets.Southbound) {
    const sheetRows: WorkbookSheetRows = {};
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      sheetRows[sheetName] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true }) as WorkbookRows;
    }
    if (isLyonsSouthboundWorkbook(sheetRows)) {
      return southboundWorkbookToPayload(sheetRows, file.name);
    }
    throw new Error(`${file.name} contains a Southbound sheet, but the expected Southbound / WAVE 3 planning structure was not recognised.`);
  }

  // Retain generic workbook support for deliberately exported planner files
  // which are neither of the two native Lyons workbooks above.
  const rejectedSheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (!csv.trim()) continue;
    try {
      return parsePlannerCsv(csv, `${file.name} · ${sheetName}`);
    } catch (error) {
      rejectedSheets.push(`${sheetName}: ${error instanceof Error ? error.message : "not a recognised Lyons planner sheet"}`);
    }
  }

  throw new Error(
    `No worksheet in ${file.name} matched either the Lyons Collections Plan or Southbound workbook formats.${rejectedSheets.length ? ` Checked: ${rejectedSheets.join(" | ")}` : ""}`
  );
}

export async function parsePlannerPlanFiles(files: File[]): Promise<PlannerCsvPayload> {
  if (!files.length) throw new Error("Select at least one Lyons planning workbook.");
  const payloads = await Promise.all(files.map(parsePlannerPlanFile));
  const dates = [...new Set(payloads.map(payload => payload.planningDate))];
  if (dates.length !== 1) throw new Error(`All uploaded plans must be for the same planning date; found ${dates.join(", ")}.`);
  return {
    schema: "slh-planner-plan-v1",
    planningDate: dates[0],
    runs: payloads.flatMap(payload => payload.runs),
    exceptions: payloads.flatMap(payload => payload.exceptions),
  };
}
