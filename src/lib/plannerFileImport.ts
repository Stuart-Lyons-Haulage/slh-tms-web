import { parsePlannerCsv, type PlannerCsvPayload } from "./plannerCsvImport";
import { isLyonsCollectionPlanRows, lyonsCollectionPlanRowsToCsv, type WorkbookRows } from "./lyonsCollectionsWorkbook";

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

  // The normal Lyons workbook is intentionally handled first. Its Collection Plan has
  // metadata rows above the real header and uses Excel serial dates/times, so treating
  // the first worksheet row as a generic CSV header loses the plan.
  const preferredNames = ["Collection Plan", ...workbook.SheetNames.filter(name => name !== "Collection Plan")];
  for (const sheetName of preferredNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true }) as WorkbookRows;
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
    `No worksheet in ${file.name} matched the Lyons Collections Plan columns (Load number, Collection, Delivery, Pallets and plan date).${rejectedSheets.length ? ` Checked: ${rejectedSheets.join(" | ")}` : ""}`
  );
}
