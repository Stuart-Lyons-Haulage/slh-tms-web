type LoadLike = { reference?: string; planningDate?: string };

function runNumber(reference: string | undefined) {
  const value = String(reference || "").trim();
  const patterns = [
    /^PLAN-\d{8}-(\d+)$/i,
    /^RUN-\d{8}-(\d+)$/i,
    /^L0*(\d+)$/i,
    /(?:^|[-_\s])RUN[-_\s]*0*(\d+)(?:$|[-_\s])/i,
    /(?:^|[-_\s])0*(\d+)$/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return Number(match[1]);
  }
  return Number.MAX_SAFE_INTEGER;
}

function compareLoads(left: LoadLike, right: LoadLike) {
  const date = String(left.planningDate || "").localeCompare(String(right.planningDate || ""));
  if (date) return date;
  const number = runNumber(left.reference) - runNumber(right.reference);
  if (number) return number;
  return String(left.reference || "").localeCompare(String(right.reference || ""), undefined, { numeric: true, sensitivity: "base" });
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await nativeFetch(input, init);
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" || !response.ok) return response;

  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  let pathname = "";
  try { pathname = new URL(url, window.location.origin).pathname; } catch { return response; }
  if (!pathname.endsWith("/api/v1/loads")) return response;

  try {
    const payload = await response.clone().json() as unknown;
    if (!Array.isArray(payload)) return response;
    const sorted = [...payload].sort(compareLoads);
    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(sorted), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
};
