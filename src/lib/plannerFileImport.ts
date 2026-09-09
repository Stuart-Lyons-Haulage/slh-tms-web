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
  const rejectedSheets: string[] = [];
  const sheetRows: WorkbookSheetRows = {};

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    sheetRows[sheetName] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true }) as WorkbookRows;
  }

  if (isLyonsSouthboundWorkbook(sheetRows)) {
    return southboundWorkbookToPayload(sheetRows, file.name);
  }

  const preferredNames = ["Collection Plan", ...workbook.SheetNames.filter(name => name !== "Collection Plan")];
  for (const sheetName of preferredNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = sheetRows[sheetName] || [];
    if (!rows.length) continue;

    if (isLyonsCollectionPlanRows(rows)) {
      try {
        const canonicalCsv = lyonsCollectionPlanRowsToCsv(rows, `${file.name} · ${sheetName}`);
        return parsePlannerCsv(canonicalCsv, `${file.name} · ${sheetName}`);
      } catch (error) {
        rejectedSheets.push(`${sheetName}: ${error instanceof Error ? error.message : "not a recognised Lyons Collection Plan"}`);
        continue;
      }
    }

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
