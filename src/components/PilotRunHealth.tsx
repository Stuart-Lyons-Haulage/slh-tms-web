import { useCallback, useEffect, useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { formatDate, formatDateTime, todayIsoDate } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";

type RunProgressStop = { id: string; sequence: number; name: string; address?: string; plannedArrivalUtc?: string };
type RunProgressVisit = { id: string; geofenceId: string; geofenceName?: string; category?: string; loadStopId?: string; enteredAtUtc: string; confirmedAtUtc?: string; dwellMinutes?: number; waitLimitMinutes?: number; isDelayed: boolean; status: string; statusReason?: string };
type RunProgressRecord = { loadId: string; loadReference: string; loadStatus: string; runState: string; totalStops: number; completedStops: number; progressPercent: number; nextStop?: RunProgressStop | null; currentVisit?: RunProgressVisit | null; lastDeparture?: { loadStopId?: string; exitedAtUtc: string; dwellMinutes: number } | null; calculatedAtUtc: string };
type RunProgressResponse = { planningDate: string; calculatedAtUtc: string; count: number; source?: string; geofenceAvailable?: boolean; warning?: string; records: RunProgressRecord[] };
type DeliveryEtaResponse = { records: Array<{ loadId: string; stopId: string; etaUtc?: string; source: string; risk: string; tachoStatus: string; breakMinutesIncluded: number; trackingUpdatedAtUtc?: string }> };
type LoadFallback = { id: string; reference: string; planningDate: string; status: string; stops?: RunProgressStop[] };

function time(value?: string) { if (!value) return "—"; const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) return value; return parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
function stateLabel(record: RunProgressRecord) { if (record.currentVisit?.isDelayed) return "SITE DELAY"; if (record.runState === "OnSiteConfirmed") return "ON SITE"; if (record.runState === "BetweenStops") return "BETWEEN STOPS"; return record.runState.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase(); }

function fallbackFromLoads(loads: LoadFallback[], planningDate: string, warning: string): RunProgressResponse {
  const calculatedAtUtc = new Date().toISOString();
  const records = loads
    .filter((load) => load.status !== "Cancelled")
    .sort((a, b) => a.reference.localeCompare(b.reference))
    .map((load) => {
      const stops = [...(load.stops || [])].sort((a, b) => a.sequence - b.sequence);
      const nextStop = stops[0] || null;
      return {
        loadId: load.id,
        loadReference: load.reference,
        loadStatus: load.status,
        runState: load.status,
        totalStops: stops.length,
        completedStops: 0,
        progressPercent: 0,
        nextStop,
        currentVisit: null,
        lastDeparture: null,
        calculatedAtUtc,
      } satisfies RunProgressRecord;
    });
  return { planningDate, calculatedAtUtc, count: records.length, source: "LoadsFallback", geofenceAvailable: false, warning, records };
}

export function PilotRunHealth() {
  const getToken = useAccessToken();
  const [etaCapture, setEtaCapture] = useState<string>("ETA sampling ready");
  const load = useCallback(async () => {
    const token = await getToken();
    const planningDate = todayIsoDate();
    try {
      return await request<RunProgressResponse>(`/api/v1/run-progress?date=${encodeURIComponent(planningDate)}`, token);
    } catch (exception) {
      const errorText = exception instanceof Error ? exception.message : "run progress unavailable";
      const loads = await request<LoadFallback[]>(`/api/v1/loads?date=${encodeURIComponent(planningDate)}`, token);
      return fallbackFromLoads(loads, planningDate, `Live run progress failed (${errorText}); showing imported runs from Loads instead.`);
    }
  }, [getToken]);
  const { data, error, loading, refresh } = useApi(load);

  const captureEta = useCallback(async () => {
    try {
      const token = await getToken();
      const etas = await request<DeliveryEtaResponse>(`/api/v1/operations/delivery-etas?date=${encodeURIComponent(todayIsoDate())}`, token, undefined, 40000);
      const result = await request<{ added: number }>("/api/v1/management/eta-snapshots/capture", token, {
        method: "POST",
        body: JSON.stringify(etas.records.map(item => ({
          loadId: item.loadId,
          stopId: item.stopId,
          etaUtc: item.etaUtc,
          source: item.source,
          risk: item.risk,
          tachoStatus: item.tachoStatus,
          breakMinutesIncluded: item.breakMinutesIncluded,
          trackingUpdatedAtUtc: item.trackingUpdatedAtUtc,
        }))),
      }, 40000);
      setEtaCapture(result.added > 0 ? `${result.added} new ETA sample${result.added === 1 ? "" : "s"} captured` : "ETA samples current");
    } catch {
      setEtaCapture("ETA sampling will retry automatically");
    }
  }, [getToken]);

  useEffect(() => { const timer = window.setInterval(() => void refresh(), 60_000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { void captureEta(); const timer = window.setInterval(() => void captureEta(), 10 * 60_000); return () => window.clearInterval(timer); }, [captureEta]);

  const summary = useMemo(() => { const records = data?.records ?? []; return { active: records.filter((record) => record.runState !== "Completed").length, onSite: records.filter((record) => Boolean(record.currentVisit)).length, delayed: records.filter((record) => record.currentVisit?.isDelayed).length, completed: records.filter((record) => record.runState === "Completed").length }; }, [data]);
  const ordered = useMemo(() => [...(data?.records ?? [])].sort((a, b) => { const aDelay = a.currentVisit?.isDelayed ? 1 : 0; const bDelay = b.currentVisit?.isDelayed ? 1 : 0; if (aDelay !== bDelay) return bDelay - aDelay; if (a.runState === "Completed" && b.runState !== "Completed") return 1; if (b.runState === "Completed" && a.runState !== "Completed") return -1; return a.loadReference.localeCompare(b.loadReference); }), [data]);

  return <section className="panel pilot-health-panel">
    <div className="title-row"><div><p className="eyebrow">Live pilot health</p><h2>Run progression from tracking & geofences</h2></div><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
    <p className="intro">This panel refreshes every minute during the pilot. It shows whether planned runs are progressing through confirmed geofence visits and highlights site dwell delays first.</p>
    <div className="metrics">
      <article className="metric"><span>{data?.count ?? 0}</span><strong>Runs today</strong><small>{data?.source === "LoadsFallback" ? "Imported loads fallback" : "Loaded into live run progress"}</small></article>
      <article className="metric"><span>{summary.active}</span><strong>Active</strong><small>Not yet fully completed</small></article>
      <article className="metric"><span>{summary.onSite}</span><strong>On site</strong><small>Currently inside a geofence</small></article>
      <article className="metric"><span>{summary.delayed}</span><strong>Site delays</strong><small>Over the configured dwell limit</small></article>
      <article className="metric"><span>{summary.completed}</span><strong>Completed</strong><small>All stops confirmed and departed</small></article>
    </div>
    {error && <p className="error">Live run progress and loads fallback could not be loaded: {error}</p>}
    {!error && data?.warning && <p className="hint">{data.warning}</p>}
    {!error && data && <p className="hint">Planning date {formatDate(data.planningDate)} · last calculated {formatDateTime(data.calculatedAtUtc)} · {data.geofenceAvailable === false ? "geofence progress not connected" : "geofence progress connected"} · {etaCapture}</p>}
    {!loading && !error && ordered.length === 0 && <p className="hint">No runs are present for today yet. This panel will populate after the planner data has created the day’s runs.</p>}
    {ordered.length > 0 && <div className="table-wrap"><table><thead><tr><th>Run</th><th>Live state</th><th>Progress</th><th>Current / next stop</th><th>Dwell / timing</th></tr></thead><tbody>{ordered.map((record) => <tr key={record.loadId}>
      <td><strong>{record.loadReference}</strong><br /><small>{record.loadStatus}</small></td>
      <td><strong>{stateLabel(record)}</strong>{record.currentVisit?.statusReason ? <><br /><small>{record.currentVisit.statusReason}</small></> : null}</td>
      <td><strong>{record.progressPercent}%</strong><br /><small>{record.completedStops} of {record.totalStops} stops</small></td>
      <td>{record.currentVisit ? <><strong>{record.currentVisit.geofenceName || "Matched geofence"}</strong><br /><small>Entered {time(record.currentVisit.enteredAtUtc)}</small></> : record.nextStop ? <><strong>{record.nextStop.name}</strong><br /><small>Next stop · planned {time(record.nextStop.plannedArrivalUtc)}</small></> : <small>No remaining stop</small>}</td>
      <td>{record.currentVisit ? <><strong>{record.currentVisit.dwellMinutes ?? 0} min dwell</strong><br /><small>{record.currentVisit.waitLimitMinutes != null ? `limit ${record.currentVisit.waitLimitMinutes} min` : "no site limit"}</small></> : record.lastDeparture ? <><strong>Departed {time(record.lastDeparture.exitedAtUtc)}</strong><br /><small>{record.lastDeparture.dwellMinutes} min on site</small></> : <small>Awaiting first confirmed site event</small>}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
