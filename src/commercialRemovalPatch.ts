import { api, type AssistantAdvice, type AssistantSnapshot } from "./lib/api";

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
  const operationalAnswer = result.answer
    .split("\n")
    .filter(line => !commercial.test(line))
    .join("\n")
    .trim();
  return {
    ...result,
    answer: operationalAnswer || "No additional operational action was identified from the current TMS snapshot.",
    suggestions: result.suggestions.filter(item => !hiddenSuggestion(item)),
  };
};
