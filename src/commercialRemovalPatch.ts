import { api, type AssistantAdvice, type AssistantSnapshot, type Load } from "./lib/api";

const commercial = /\b(margin|margins|cost|costs|costing|costings|revenue|rate|rates|pricing|unpriced|invoice|invoicing)\b/i;
const hiddenSuggestion = (item: { id?: string; title?: string; detail?: string }) =>
  item.id === "loads-unpriced" || item.id === "loads-negative-margin" || commercial.test(`${item.title || ""} ${item.detail || ""}`);

const originalSnapshot = api.assistantSnapshot;
api.assistantSnapshot = async (...args: Parameters<typeof originalSnapshot>): Promise<AssistantSnapshot> => {
  const result = await originalSnapshot(...args);
  return {
    ...result,
    metrics: { ...result.metrics, unpricedLoads: 0, negativeMarginLoads: 0 },
    suggestions: result.suggestions.filter(item => !hiddenSuggestion(item)),
  };
};

const originalAdvice = api.assistantAdvice;
api.assistantAdvice = async (...args: Parameters<typeof originalAdvice>): Promise<AssistantAdvice> => {
  const result = await originalAdvice(...args);
  const operationalAnswer = result.answer.split("\n").filter(line => !commercial.test(line)).join("\n").trim();
  return {
    ...result,
    answer: operationalAnswer || "No additional operational action was identified from the current TMS snapshot.",
    suggestions: result.suggestions.filter(item => !hiddenSuggestion(item)),
  };
};

// Costing is not part of the SLH operating TMS. Keep the legacy method harmless so
// older route screens cannot fail after calculating a route simply because they
// previously attempted to save mileage through the commercial endpoint.
const originalUpdateCommercial = api.updateLoadCommercial;
api.updateLoadCommercial = async (
  id: Parameters<typeof originalUpdateCommercial>[0],
  _payload: Parameters<typeof originalUpdateCommercial>[1],
  token?: Parameters<typeof originalUpdateCommercial>[2],
): Promise<Load> => {
  const loads = await api.loads(undefined, token);
  const load = loads.find(item => item.id === id);
  if (!load) throw new Error("The run could not be refreshed after the route calculation.");
  return load;
};

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.dataset.slhCommercialRemoval = "true";
  style.textContent = ".commercial-editor{display:none!important}";
  document.head.appendChild(style);
}
