const originalResponseJson = Response.prototype.json;

type JsonRecord = Record<string, unknown>;

function textValue(value: unknown, fallback = "") {
  if (value == null) return fallback;
  const valueText = String(value).trim();
  return valueText || fallback;
}

function safeDateText(value: unknown) {
  const text = textValue(value, "");
  if (!text) return "";
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? "" : text;
}

function safeNumber(value: unknown) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normaliseStop(value: unknown, index: number): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const stop = normaliseRecord(value as JsonRecord);
  stop.id = textValue(stop.id, `legacy-stop-${index + 1}`);
  stop.name = textValue(stop.name, `Stop ${index + 1}`);
  stop.sequence = safeNumber(stop.sequence) ?? index + 1;
  stop.latitude = safeNumber(stop.latitude);
  stop.longitude = safeNumber(stop.longitude);
  stop.plannedArrivalUtc = safeDateText(stop.plannedArrivalUtc);
  return stop;
}

function normaliseRecord(input: JsonRecord): JsonRecord {
  const record: JsonRecord = { ...input };

  // Promoted orders created by older import versions can contain nulls even
  // though the current TypeScript contract describes these as strings.
  const looksLikeOrder =
    "collectionDate" in record ||
    ("customerCode" in record && ("pallets" in record || "deliveryDate" in record));
  if (looksLikeOrder) {
    record.id = textValue(record.id, `legacy-order-${Math.random().toString(36).slice(2)}`);
    record.reference = textValue(record.reference, "Reference missing");
    record.customerCode = textValue(record.customerCode, "Customer missing");
    record.collectionDate = safeDateText(record.collectionDate);
    record.deliveryDate = safeDateText(record.deliveryDate) || safeDateText(record.collectionDate);
    record.deliveryWindowStartUtc = safeDateText(record.deliveryWindowStartUtc);
    record.deliveryWindowEndUtc = safeDateText(record.deliveryWindowEndUtc);
    record.status = textValue(record.status, "ReadyToPlan");
  }

  // Legacy load rows have also existed without a populated Stops collection or
  // with numeric/null enum values. Keep the board usable and let the planner
  // correct the record rather than throwing during React render.
  const looksLikeLoad =
    "planningDate" in record && "reference" in record &&
    ("vehicleId" in record || "driverId" in record || "stops" in record);
  if (looksLikeLoad) {
    record.id = textValue(record.id, `legacy-load-${Math.random().toString(36).slice(2)}`);
    record.reference = textValue(record.reference, "Load reference missing");
    record.planningDate = safeDateText(record.planningDate);
    record.status = textValue(record.status, "Planned");
    const stops = Array.isArray(record.stops) ? record.stops : [];
    record.stops = stops
      .map((stop, index) => normaliseStop(stop, index))
      .filter((stop): stop is JsonRecord => Boolean(stop));
  }

  // Stop/ETA/tracking timestamps are rendered by Intl.DateTimeFormat. Invalid
  // imported strings throw RangeError during React render, which used to take
  // down the entire Planner route. Blank invalid values so the UI shows its
  // existing fallback instead.
  for (const key of [
    "plannedArrivalUtc",
    "plannedDutyUtc",
    "eventTimeUtc",
    "lastEventTimeUtc",
    "etaUtc",
    "trackingUpdatedAtUtc",
    "receivedAtUtc",
    "reviewedAtUtc",
    "createdAtUtc",
    "updatedAtUtc",
    "lastTachoSyncUtc",
    "fleetioLastSyncedUtc",
    "fleetioPmiDueUtc",
    "fleetioMotDueUtc",
  ]) {
    if (key in record) record[key] = safeDateText(record[key]);
  }

  if ("name" in record) record.name = textValue(record.name, "Stop name missing");
  if ("reference" in record) record.reference = textValue(record.reference, "Reference missing");
  if ("status" in record) record.status = textValue(record.status, "Unknown");

  return record;
}

function normalisePayload(value: unknown): unknown {
  if (Array.isArray(value))
    return value
      .map(normalisePayload)
      .filter((item) => item !== undefined && item !== null);
  if (!value || typeof value !== "object") return value;

  const record = normaliseRecord(value as JsonRecord);
  for (const [key, child] of Object.entries(record)) {
    record[key] = normalisePayload(child);
  }
  return record;
}

function isTmsApiResponse(url: string) {
  return (
    url.includes("/api/v1/") ||
    url.includes("/tms-api/") ||
    url.includes("slh-tms-api-prod.")
  );
}

// Normalise at the network boundary. This protects every Planner render path,
// including existing historic rows, without changing the API evidence itself.
Response.prototype.json = async function patchedJson(...args: Parameters<Response["json"]>) {
  const payload = await originalResponseJson.apply(this, args);
  return isTmsApiResponse(this.url) ? normalisePayload(payload) : payload;
};
