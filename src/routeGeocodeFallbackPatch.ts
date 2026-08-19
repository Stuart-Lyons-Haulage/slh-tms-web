import { api } from "./lib/api";

const originalGeocode = api.geocode;

function hasResult(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const results = (value as { results?: unknown[] }).results;
  return Array.isArray(results) && results.length > 0;
}

function fallbackQuery(value: string) {
  const firstPart = value.split(/[|·]/)[0]?.trim() || value.trim();
  const cleaned = firstPart
    .replace(/^\s*(to|from|collect(?:ion)?|deliver(?:y)?)\s*[:\-]?\s*/i, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:pallets?|trays?|trolleys?)\b.*$/i, "")
    .trim();
  if (!cleaned || cleaned.toLowerCase() === value.trim().toLowerCase()) return undefined;
  return /\b(united kingdom|uk)\b/i.test(cleaned) ? cleaned : `${cleaned}, United Kingdom`;
}

api.geocode = async (...args: Parameters<typeof originalGeocode>): ReturnType<typeof originalGeocode> => {
  const [address, token] = args;
  let first: Awaited<ReturnType<typeof originalGeocode>> | undefined;
  try {
    first = await originalGeocode(address, token);
    if (hasResult(first)) return first;
  } catch {
    // Retry below using a cleaned site name when the imported planner detail is not a postal address.
  }

  const retry = fallbackQuery(address);
  if (!retry) return first ?? originalGeocode(address, token);
  return originalGeocode(retry, token);
};
