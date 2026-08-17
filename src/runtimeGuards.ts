const originalResponseJson = Response.prototype.json;

type JsonRecord = Record<string, unknown>;

function textValue(value: unknown, fallback = "") {
  if (value == null) return fallback;
  const valueText = String(value).trim();
  return valueText || fallback;
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
    record.collectionDate = textValue(record.collectionDate, "");
    record.deliveryDate = textValue(record.deliveryDate, textValue(record.collectionDate, ""));
    record.status = textValue(record.status, "ReadyToPlan");
  }

  // Legacy load rows have also existed without a populated Stops collection or
  // with numeric/null enum values. Keep the board usable and let the planner
  // correct the record rather than throwing during React render.
  const looksLikeLoad =
    "planningDate" in record && "reference" in record &&
    ("vehicleId" in record || "driverId" in record || "stops" in record);
  if (looksLikeLoad) {
    record.reference = textValue(record.reference, "Load reference missing");
    record.planningDate = textValue(record.planningDate, "");
    record.status = textValue(record.status, "Planned");
    if (!Array.isArray(record.stops)) record.stops = [];
  }

  // Any status that is present must be safe for existing .toLowerCase() calls.
  if ("status" in record) record.status = textValue(record.status, "Unknown");

  return record;
}

function normalisePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalisePayload);
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
