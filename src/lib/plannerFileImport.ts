import { parsePlannerCsv, type PlannerCsvPayload } from "./plannerCsvImport";

const workbookExtension = /\.(xlsx|xls|xlsm)$/i;

export async function parsePlannerPlanFile(file: File): Promise<PlannerCsvPayload> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    return parsePlannerCsv(await file.text(), file.name);
  }

  if (!workbookExtension.test(file.name)) {
    throw new Error("Lyons plan format not recognised. Upload the usual CSV, XLSX, XLS or XLSM file.");
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: false });
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
    `No worksheet in ${file.name} matched the Lyons Collections Plan columns (Load number, Collection, Delivery, Pallets and Planned dispatch date).${rejectedSheets.length ? ` Checked: ${rejectedSheets.join(" | ")}` : ""}`
  );
}
