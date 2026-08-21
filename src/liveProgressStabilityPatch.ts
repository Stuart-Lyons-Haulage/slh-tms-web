export type ProgressRefreshEnvelope = { source?: string; warning?: string };

export function isDegradedProgressRefresh(value?: ProgressRefreshEnvelope | null) {
  return Boolean(value && value.source === "PlanningRegisterSafeFallback");
}
