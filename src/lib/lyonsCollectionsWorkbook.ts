export type WorkbookCell = string | number | boolean | Date | null | undefined;
export type WorkbookRows = WorkbookCell[][];

const canonicalHeaders = [
  "Load number",
  "Collection",
  "Delivery",
  "Pallets",
  "Planned dispatch date",
  "Driver",
  "Vehicle",
  "Trailer",
  "Notes",
  "Collect from",
  "Collect to",
  "Deadline",
  "Collection date",
  "Due date",
];

function clean(value: WorkbookCell) { return String(value ?? "").trim(); }
function key(value: WorkbookCell) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function excelSerialToDate(value: number) {
  if (!Number.isFinite(value) || value < 1) return undefined;
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(value) * 86400000);
}

function isoDate(value: WorkbookCell) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return excelSerialToDate(value)?.toISOString().slice(0, 10) || "";
  const text = clean(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const british = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (british) return `${british[3]}-${british[2].padStart(2, "0")}-${british[1].padStart(2, "0")}`;
  const serial = Number(text);
  return Number.isFinite(serial) && serial > 1000 ? excelSerialToDate(serial)?.toISOString().slice(0, 10) || "" : "";
}

function time(value: WorkbookCell) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60) % (24 * 60);
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  }
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  const text = clean(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : text;
}

function number(value: WorkbookCell) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(clean(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function csv(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function headerMap(row: WorkbookRows[number]) {
  const map = new Map<string, number>();
  row.forEach((value, index) => { const normalized = key(value); if (normalized) map.set(normalized, index); });
  return map;
}

function col(map: Map<string, number>, ...names: string[]) {
  for (const name of names) {
    const index = map.get(key(name));
    if (index != null) return index;
  }
  return -1;
}

function valueAt(row: WorkbookRows[number], index: number) { return index >= 0 ? row[index] : undefined; }

function detectPlanDate(rows: WorkbookRows, headerRowIndex: number) {
  for (let r = Math.max(0, headerRowIndex - 8); r < headerRowIndex; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (key(row[c]) !== "collectiondate") continue;
      for (let offset = 1; offset <= 3; offset++) {
        const parsed = isoDate(row[c + offset]);
        if (parsed) return parsed;
      }
    }
  }
  return "";
}

export function isLyonsCollectionPlanRows(rows: WorkbookRows) {
  return rows.slice(0, 20).some(row => {
    const headers = new Set(row.map(key));
    return headers.has("loadnumber") && headers.has("collectionsite") && headers.has("deliverydestination") &&
      (headers.has("palletsordered") || headers.has("pallets"));
  });
}

export function lyonsCollectionPlanRowsToCsv(rows: WorkbookRows, fileName = "Lyons Collections Plan") {
  const headerRowIndex = rows.slice(0, 30).findIndex(row => {
    const headers = new Set(row.map(key));
    return headers.has("loadnumber") && headers.has("collectionsite") && headers.has("deliverydestination") &&
      (headers.has("palletsordered") || headers.has("pallets"));
  });
  if (headerRowIndex < 0) throw new Error("Collection Plan header row was not found.");

  const headers = headerMap(rows[headerRowIndex]);
  const loadCol = col(headers, "Load Number", "Load");
  const collectionCol = col(headers, "Collection Site", "Collection");
  const deliveryCol = col(headers, "Delivery Destination", "Delivery", "Destination");
  const palletsCol = col(headers, "Pallets Ordered", "Pallets", "Quantity");
  const driverCol = col(headers, "Driver");
  const vehicleCol = col(headers, "Vehicle", "Registration");
  const trailerCol = col(headers, "Trailer", "Trailer Number");
  const notesCol = col(headers, "Notes");
  const collectFromCol = col(headers, "Planned Collect Time From", "Collect From", "Collection From");
  const collectToCol = col(headers, "Planned Collect Time To", "Collect To", "Collection To");
  const deadlineCol = col(headers, "Deadline Time", "Deadline", "Deliver By");
  const collectionDateCol = col(headers, "Collection Site Arr Date", "Collection Date");
  const deliveryDateCol = col(headers, "Delivered Date", "Delivery Date", "Due Date");
  const planDate = detectPlanDate(rows, headerRowIndex);
  if (!planDate) throw new Error("Collection Plan date could not be read from the workbook.");

  const output: string[][] = [canonicalHeaders];
  let sourceRow = 0;
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const load = clean(valueAt(row, loadCol));
    const collection = clean(valueAt(row, collectionCol));
    const delivery = clean(valueAt(row, deliveryCol));
    const pallets = number(valueAt(row, palletsCol));
    if (!load || !collection || !delivery || !pallets || pallets <= 0) continue;
    if (!/^\d+(?:\.0+)?$/.test(load) && !/[A-Za-z]/.test(load)) continue;

    sourceRow++;
    const collectionDate = isoDate(valueAt(row, collectionDateCol)) || planDate;
    const dueDate = isoDate(valueAt(row, deliveryDateCol)) || planDate;
    output.push([
      load.replace(/\.0+$/, ""),
      collection,
      delivery,
      String(Math.round(pallets * 1000) / 1000),
      planDate,
      clean(valueAt(row, driverCol)),
      clean(valueAt(row, vehicleCol)),
      clean(valueAt(row, trailerCol)),
      [clean(valueAt(row, notesCol)), `Workbook row ${r + 1}`, `Source ${fileName}`].filter(Boolean).join(" | "),
      time(valueAt(row, collectFromCol)),
      time(valueAt(row, collectToCol)),
      time(valueAt(row, deadlineCol)),
      collectionDate,
      dueDate,
    ]);
  }

  if (!sourceRow) throw new Error("Collection Plan contains no positive-pallet load rows.");
  return output.map(row => row.map(csv).join(",")).join("\n");
}
