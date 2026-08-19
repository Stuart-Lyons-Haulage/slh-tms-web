import { request } from './api';

export type AttentionItem = { id: string; severity: 'High' | 'Medium' | 'Low'; type: string; title: string; detail: string; entityId?: string; entityType?: string; href: string };
export type AttentionResponse = { planningDate: string; generatedAtUtc: string; source?: string; count: number; items: AttentionItem[] };
export type SearchResult = { type: string; id: string; label: string; detail: string; href: string };
export type FreshnessSource = { name: string; lastUpdatedUtc?: string; ageMinutes?: number; state: 'green' | 'amber' | 'red' };
export type FreshnessResponse = { generatedAtUtc: string; sources: FreshnessSource[] };
export type TimelineEvent = { atUtc: string; title: string; detail: string; source: string; by?: string };
export type TimelineResponse = { entityType: 'Run' | 'Order'; id: string; reference: string; planningDate?: string; status: string; events: TimelineEvent[] };
export type PlanLockInfo = { planningDate: string; lockedAtUtc: string; lockedBy?: string; baselineRuns: number };
export type ReadinessResponse = { planningDate: string; generatedAtUtc: string; source?: string; ready: boolean; runs: number; assignedDrivers: number; activeDrivers: number; assignedVehicles: number; activeVehicles: number; missingAllocations: number; vorConflicts: number; tachoConcerns: number; geofenceGaps: number; unreviewedOrders: number; planLock?: PlanLockInfo };
export type PlanStabilityResponse = { from: string; to: string; lockedDays: number; baselineRuns: number; changedRuns: number; stabilityPercent?: number; driverSwaps: number; vehicleSwaps: number; routeAmendments: number; runChanges: number };

type ConfidenceResponse = {
  generatedAtUtc: string;
  sageHr: { lastSyncUtc?: string };
  tachoMaster: { lastSyncUtc?: string };
  dotTracking: { latestEventUtc?: string };
  emailIntake: { lastReceivedUtc?: string };
};
type TachoLiveStatus = { configured: boolean; connected: boolean; matchedVehicleCount: number; message?: string };

function freshnessSource(name: string, lastUpdatedUtc: string | undefined, now: number, amberAfter: number, redAfter: number): FreshnessSource {
  const ageMinutes = lastUpdatedUtc ? Math.max(0, (now - new Date(lastUpdatedUtc).getTime()) / 60000) : undefined;
  const state: FreshnessSource['state'] = ageMinutes == null ? 'red' : ageMinutes <= amberAfter ? 'green' : ageMinutes <= redAfter ? 'amber' : 'red';
  return { name, lastUpdatedUtc, ageMinutes: ageMinutes == null ? undefined : Math.round(ageMinutes * 10) / 10, state };
}

async function freshness(token?: string): Promise<FreshnessResponse> {
  const [confidence, liveTacho] = await Promise.all([
    request<ConfidenceResponse>('/api/v1/operations/confidence', token),
    request<TachoLiveStatus>('/api/v1/integrations/tachomaster/status', token).catch(() => null),
  ]);
  const now = Date.now();
  const tacho = liveTacho?.connected
    ? { name: 'TachoMaster', lastUpdatedUtc: new Date(now).toISOString(), ageMinutes: 0, state: 'green' as const }
    : freshnessSource('TachoMaster', confidence.tachoMaster.lastSyncUtc, now, 30, 120);
  return {
    generatedAtUtc: confidence.generatedAtUtc,
    sources: [
      freshnessSource('Tracking', confidence.dotTracking.latestEventUtc, now, 10, 30),
      tacho,
      freshnessSource('Info mailbox', confidence.emailIntake.lastReceivedUtc, now, 15, 60),
      freshnessSource('Sage HR', confidence.sageHr.lastSyncUtc, now, 180, 720),
    ],
  };
}

export const intelligenceApi = {
  attention: (date: string, token?: string) => request<AttentionResponse>(`/api/v1/operations/attention-snapshot?date=${encodeURIComponent(date)}`, token, undefined, 40000),
  search: (q: string, token?: string) => request<SearchResult[]>(`/api/v1/intelligence/search?q=${encodeURIComponent(q)}`, token),
  freshness,
  runTimeline: (id: string, token?: string) => request<TimelineResponse>(`/api/v1/intelligence/run-timeline/${encodeURIComponent(id)}`, token, undefined, 40000),
  orderTimeline: (id: string, token?: string) => request<TimelineResponse>(`/api/v1/intelligence/timeline/order/${encodeURIComponent(id)}`, token, undefined, 40000),
  planLock: (date: string, token?: string) => request<PlanLockInfo | null>(`/api/v1/intelligence/plan-lock/${encodeURIComponent(date)}`, token),
  lockPlan: (date: string, token?: string) => request<PlanLockInfo>(`/api/v1/intelligence/plan-lock/${encodeURIComponent(date)}`, token, { method: 'POST' }),
  readiness: (date: string, token?: string) => request<ReadinessResponse>(`/api/v1/operations/readiness-snapshot?date=${encodeURIComponent(date)}`, token, undefined, 40000),
  stability: (from: string, to: string, token?: string) => request<PlanStabilityResponse>(`/api/v1/intelligence/plan-stability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token, undefined, 40000),
};
