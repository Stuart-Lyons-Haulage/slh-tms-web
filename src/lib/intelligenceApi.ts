import { request } from './api';

export type AttentionItem = { id: string; severity: 'High' | 'Medium' | 'Low'; type: string; title: string; detail: string; entityId?: string; entityType?: string; href: string };
export type AttentionResponse = { planningDate: string; generatedAtUtc: string; count: number; items: AttentionItem[] };
export type SearchResult = { type: string; id: string; label: string; detail: string; href: string };
export type FreshnessSource = { name: string; lastUpdatedUtc?: string; ageMinutes?: number; state: 'green' | 'amber' | 'red' };
export type FreshnessResponse = { generatedAtUtc: string; sources: FreshnessSource[] };
export type TimelineEvent = { atUtc: string; title: string; detail: string; source: string; by?: string };
export type TimelineResponse = { entityType: 'Run' | 'Order'; id: string; reference: string; planningDate?: string; status: string; events: TimelineEvent[] };
export type PlanLockInfo = { planningDate: string; lockedAtUtc: string; lockedBy?: string; baselineRuns: number };
export type ReadinessResponse = { planningDate: string; generatedAtUtc: string; ready: boolean; runs: number; assignedDrivers: number; activeDrivers: number; assignedVehicles: number; activeVehicles: number; missingAllocations: number; vorConflicts: number; tachoConcerns: number; geofenceGaps: number; unreviewedOrders: number; planLock?: PlanLockInfo };
export type PlanStabilityResponse = { from: string; to: string; lockedDays: number; baselineRuns: number; changedRuns: number; stabilityPercent?: number; driverSwaps: number; vehicleSwaps: number; routeAmendments: number; runChanges: number };

export const intelligenceApi = {
  attention: (date: string, token?: string) => request<AttentionResponse>(`/api/v1/intelligence/attention?date=${encodeURIComponent(date)}`, token, undefined, 40000),
  search: (q: string, token?: string) => request<SearchResult[]>(`/api/v1/intelligence/search?q=${encodeURIComponent(q)}`, token),
  freshness: (token?: string) => request<FreshnessResponse>('/api/v1/intelligence/freshness', token),
  runTimeline: (id: string, token?: string) => request<TimelineResponse>(`/api/v1/intelligence/timeline/run/${encodeURIComponent(id)}`, token, undefined, 40000),
  orderTimeline: (id: string, token?: string) => request<TimelineResponse>(`/api/v1/intelligence/timeline/order/${encodeURIComponent(id)}`, token, undefined, 40000),
  planLock: (date: string, token?: string) => request<PlanLockInfo | null>(`/api/v1/intelligence/plan-lock/${encodeURIComponent(date)}`, token),
  lockPlan: (date: string, token?: string) => request<PlanLockInfo>(`/api/v1/intelligence/plan-lock/${encodeURIComponent(date)}`, token, { method: 'POST' }),
  readiness: (date: string, token?: string) => request<ReadinessResponse>(`/api/v1/intelligence/readiness?date=${encodeURIComponent(date)}`, token, undefined, 40000),
  stability: (from: string, to: string, token?: string) => request<PlanStabilityResponse>(`/api/v1/intelligence/plan-stability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token, undefined, 40000),
};
