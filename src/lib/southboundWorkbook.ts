import { parsePlannerCsv, type PlannerCsvPayload } from "./plannerCsvImport";
import type { WorkbookCell, WorkbookRows } from "./lyonsCollectionsWorkbook";

export type WorkbookSheetRows = Record<string, WorkbookRows>;

const headers = [
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
  "Reference",
  "Unit",
];

function clean(value: unknown) { return String(value ?? "").trim(); }
function csv(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function normalise(value: unknown) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function excelSerialToDate(value: number) {
  if (!Number.isFinite(value) || value < 1) return undefined;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
}
function isoDate(value: WorkbookCell) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return excelSerialToDate(value)?.toISOString().slice(0, 10) || "";
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const embedded = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return embedded ? `${embedded[3]}-${embedded[2].padStart(2, "0")}-${embedded[1].padStart(2, "0")}` : "";
}
function clock(value: WorkbookCell) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  if (typeof value === "number" && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const text = clean(value);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}
function quantityFromText(value: unknown) {
  const text = clean(value);
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:p|plt|pallets?)\b/gi)];
  if (!matches.length) return undefined;
  return matches.reduce((sum, match) => sum + Number(match[1]), 0);
}
function unitFromText(...values: unknown[]) {
  const text = values.map(value => clean(value)).join(" ").toLowerCase();
  if (/troll(?:y|ey|ies)/.test(text)) return "Trollies";
  if (/dolav/.test(text)) return "Dolavs";
  if (/crate/.test(text)) return "Crates";
  if (/tray/.test(text)) return "Trays";
  if (/packag|film/.test(text)) return "Packaging";
  if (/market|wave\s*3|overnight/.test(text)) return "Market / overnight";
  return "";
}
function splitDelivery(value: string) {
  const text = clean(value);
  if (!text) return [];
  return text.split(/\s*\/\s*|\s*,\s*|\s+and\s+/i).map(part => part.trim()).filter(Boolean);
}
function words(value: unknown) {
  return clean(value).toUpperCase().split(/[^A-Z0-9]+/).filter(word => word.length >= 4);
}
function withinOneEdit(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (left.length > right.length) i++;
    else if (right.length > left.length) j++;
    else { i++; j++; }
  }
  if (i < left.length || j < right.length) edits++;
  return edits <= 1;
}
function segmentMatchesDestination(segment: string, destination: string) {
  const segmentNormal = normalise(segment);
  const destinationNormal = normalise(destination);
  if (destinationNormal && segmentNormal.includes(destinationNormal)) return true;
  const destinationWords = words(destination).filter(word => !["NWF", "SITE", "FARM", "FOODS"].includes(word));
  const segmentWords = words(segment);
  return destinationWords.some(destinationWord => segmentWords.some(segmentWord =>
    destinationWord.length >= 5 && segmentWord.length >= 5 && withinOneEdit(destinationWord, segmentWord)));
}
function allocationFromNote(note: string, destinations: string[]) {
  const result = new Map<string, number>();
  const segments = splitDelivery(note);
  for (const destination of destinations) {
    for (const segment of segments) {
      const quantity = quantityFromText(segment);
      if (quantity == null || !segmentMatchesDestination(segment, destination)) continue;
      result.set(destination, quantity);
      break;
    }
  }
  return result;
}
function parseTransfer(text: string) {
  const cleaned = clean(text).replace(/\s+/g, " ");
  const loop = cleaned.match(/^(.+?)\s*-\s*(.+?)\s*-\s*\1\b/i);
  if (loop) return { collection: loop[1].trim(), delivery: loop[2].trim(), returnTo: loop[1].trim() };
  const fromTo = cleaned.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:ready|load|deliver|tip|after|before|am\b|pm\b|\d{1,2}:\d{2})|$)/i);
  if (fromTo) return { collection: fromTo[1].trim(), delivery: fromTo[2].trim() };
  const simple = cleaned.match(/^(.+?)\s+to\s+(.+?)(?=\s+(?:crate|tray|packag|film|transfer|load|ready|tip|am\b|pm\b|\d{1,2}:\d{2})|$)/i);
  return simple ? { collection: simple[1].trim(), delivery: simple[2].trim() } : undefined;
}

export function isLyonsSouthboundWorkbook(sheets: WorkbookSheetRows) {
  const southbound = sheets.Southbound || [];
  return southbound.slice(0, 10).some(r => r.some(cell => clean(cell).toUpperCase() === "SOUTHBOUNDS")) && Boolean(sheets["Collection Board"] || sheets["WAVE 3"]);
}

export function southboundWorkbookToPayload(sheets: WorkbookSheetRows, fileName: string): PlannerCsvPayload {
  const southbound = sheets.Southbound || [];
  // In the live workbook G1 is the DATE: label and H1 contains the date value.
  const planningDate = isoDate(southbound?.[0]?.[7]);
  if (!planningDate) throw new Error("Southbound planning date could not be read from cell H1.");

  const output: string[][] = [headers];
  const exceptions: PlannerCsvPayload["exceptions"] = [];
  const push = (values: unknown[]) => output.push(values.map(value => String(value ?? "")));

  for (let index = 5; index < southbound.length; index++) {
    const r = southbound[index] || [];
    const job = clean(r[0]);
    if (!/^S\d+/i.test(job)) continue;
    const collection = clean(r[1]);
    const delivery = clean(r[2]);
    if (!collection || !delivery) continue;
    const reference = clean(r[3]);
    const dueDate = isoDate(r[4]) || planningDate;
    const collectFrom = clock(r[5]);
    const note = clean(r[6]);
    const driver = clean(r[7]);
    const destinations = splitDelivery(delivery);
    const allocations = allocationFromNote(note, destinations);
    const total = quantityFromText(note);
    const unit = unitFromText(collection, delivery, note);
    const targets = destinations.length ? destinations : [delivery];
    for (const target of targets) {
      const pallets = allocations.get(target) ?? (targets.length === 1 ? total : undefined);
      push([job, collection, target, pallets ?? "", planningDate, driver, "", "", `Southbound row ${index + 1}${note ? ` | ${note}` : ""} | Source ${fileName}`, collectFrom, "", "", planningDate, dueDate, reference, unit]);
    }
  }

  for (let index = 5; index < southbound.length; index++) {
    const r = southbound[index] || [];
    const job = clean(r[16]);
    const description = clean(r[17]);
    const driver = clean(r[18]);
    if (!/^T\d+/i.test(job) || !description) continue;
    const movement = parseTransfer(description);
    if (!movement) {
      exceptions.push({ severity: "Warning", runRef: job, code: "SouthboundTransferNeedsReview", detail: `${description} — collection/delivery could not be separated safely.` });
      continue;
    }
    const pallets = quantityFromText(description);
    const unit = unitFromText(description);
    push([job, movement.collection, movement.delivery, pallets ?? "", planningDate, driver, "", "", `${description} | Source ${fileName}`, "", "", "", planningDate, planningDate, "", unit]);
    if (movement.returnTo) push([job, movement.delivery, movement.returnTo, "", planningDate, driver, "", "", `Return leg from ${description} | Source ${fileName}`, "", "", "", planningDate, planningDate, "", unit]);
  }

  const wave3 = sheets["WAVE 3"] || [];
  const waveRanges = [[3, 18], [20, wave3.length]] as const;
  for (const [from, to] of waveRanges) {
    const chill = from >= 20;
    for (let i = from; i < to; i++) {
      const r = wave3[i] || [];
      // WAVE 3 has four five-column destination blocks: Bracknell, Brinklow,
      // Aylesford and Leyland. Previous parsing stopped at Aylesford.
      for (const start of [0, 5, 10, 15]) {
        const supplier = clean(r[start]);
        const po = clean(r[start + 1]);
        if (!supplier || !po || !/[A-Za-z]/.test(supplier) || !/[A-Za-z0-9]/.test(po) || /^supplier$/i.test(supplier)) continue;
        const baseDestination = clean(wave3?.[chill ? 18 : 1]?.[start]);
        if (!baseDestination) continue;
        const destination = baseDestination.toLowerCase().includes("chill") || !chill ? baseDestination : `${baseDestination} Chill`;
        push([`W3-${start}-${i + 1}-${po}`, supplier, `Waitrose ${destination}`, "", planningDate, "", "", "", `Wave 3 overnight Waitrose movement | Source ${fileName} · WAVE 3 row ${i + 1}`, "", "", "", planningDate, planningDate, po, "Market / overnight"]);
      }
    }
  }

  const marketSheets = ["Covent Garden", "Covent 2", "Covent 3", "Spitalfields", "Spit 2", "Spit 3", "Western Int", "West 3", "Brighton"];
  let currentMarketDetail = 0;
  for (const sheetName of marketSheets) {
    const rows = sheets[sheetName] || [];
    const market = clean(rows?.[2]?.[0]);
    const sheetDate = isoDate(rows?.[4]?.[0]);
    if (!market || !sheetDate) continue;
    if (sheetDate !== planningDate) {
      exceptions.push({ severity: "Info", runRef: sheetName, code: "StaleMarketSheetIgnored", detail: `${sheetName} is dated ${sheetDate}; workbook planning date is ${planningDate}. It was not imported as current work.` });
      continue;
    }
    for (let i = 7; i < rows.length; i++) {
      const r = rows[i] || [];
      const salesman = clean(r[0]);
      const pallets = typeof r[1] === "number" ? r[1] : Number(clean(r[1]));
      const sender = clean(r[2]);
      if (!salesman || !sender) continue;
      currentMarketDetail++;
      push([`MARKET-${sheetName}-${i + 1}`, sender, market, Number.isFinite(pallets) && pallets > 0 ? pallets : "", planningDate, "", "", "", `Market stall ${salesman} | Source ${fileName} · ${sheetName} row ${i + 1}`, "", "", "", planningDate, planningDate, salesman, "Market / overnight"]);
    }
  }

  if (currentMarketDetail === 0) {
    const board = sheets["Collection Board"] || [];
    for (let i = 3; i < board.length; i++) {
      const r = board[i] || [];
      const required = clean(r[1]).toLowerCase() === "yes";
      const description = clean(r[2]);
      if (!required || !/market/i.test(description)) continue;
      const numeric = typeof r[3] === "number" ? r[3] : Number(clean(r[3]));
      const driver = clean(r[4]);
      const note = clean(r[5]);
      const collection = description.replace(/\bmarket\b.*$/i, "").trim();
      push([`MARKET-BOARD-${i + 1}`, collection || description, "Market destination unresolved", Number.isFinite(numeric) && numeric > 0 ? numeric : "", planningDate, driver, "", "", `Current Collection Board market work; destination/stall detail not current${note ? ` | ${note}` : ""} | Source ${fileName}`, "", "", "", planningDate, planningDate, "", "Market / overnight"]);
      exceptions.push({ severity: "Warning", runRef: `MARKET-BOARD-${i + 1}`, code: "MarketDestinationNeedsReview", detail: `${description} is required, but the detailed market tabs are not dated ${planningDate}. Movement retained without inventing a market/stall.` });
    }
  }

  if (output.length === 1) throw new Error("Southbound workbook contains no recognised current movements.");
  const canonicalCsv = output.map(values => values.map(csv).join(",")).join("\n");
  const payload = parsePlannerCsv(canonicalCsv, fileName);
  payload.exceptions.push(...exceptions);
  return payload;
}
