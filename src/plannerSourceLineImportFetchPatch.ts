export {};

const plannerSourceLineNativeFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (method !== "POST" || !url.includes("/tms-api/api/v1/planning/import-plan") || typeof init?.body !== "string") {
    return plannerSourceLineNativeFetch(input, init);
  }

  try {
    const payload = JSON.parse(init.body) as { schema?: string };
    if (!String(payload.schema || "").startsWith("slh-planner-plan-v3-source-lines")) {
      return plannerSourceLineNativeFetch(input, init);
    }

    const rewritten = url.replace("/tms-api/api/v1/planning/import-plan", "/tms-api/api/v1/planning/import-source-plan");
    return plannerSourceLineNativeFetch(rewritten, init);
  } catch {
    return plannerSourceLineNativeFetch(input, init);
  }
};
