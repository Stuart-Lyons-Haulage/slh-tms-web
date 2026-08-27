import { useCallback, useEffect, useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";
import "../run-geofence-linkage.css";

export type LinkageRecord = {
  loadId: string;
  run: string;
  stopId: string;
  sequence: number;
  stopName: string;
  siteMatched: boolean;
  siteCode?: string;
  siteName?: string;
  geofenceLinked: boolean;
  geofenceName?: string;
  issue?: string;
  visitRecorded: boolean;
  latestEnterUtc?: string;
  latestExitUtc?: string;
  confirmedAtUtc?: string;
  evidence?: string;
};

export type LinkageResponse = {
  runs?: number;
  linkedStops: number;
  stops: number;
  stopsWithVisitEvidence?: number;
  runsWithVisitEvidence?: number;
  siteNameUnresolved: number;
  siteMatchedButGeofenceUnlinked: number;
  records: LinkageRecord[];
};

function state(stop: LinkageRecord) {
  if (!stop.geofenceLinked) return stop.siteMatched ? "NO GEOFENCE" : "SITE UNRESOLVED";
  if (stop.latestExitUtc) return "DEPARTED";
  if (stop.visitRecorded) return "ON SITE";
  return "LINKED";
}

function time(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function useRunGeofenceLinkage(enabled: boolean) {
  const token = useAccessToken();
  const date = todayIsoDate();
  const [data, setData] = useState<LinkageResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await request<LinkageResponse>(`/api/v1/planning/geofence-linkage?date=${encodeURIComponent(date)}`, await token(), { cache: "no-store" }, 90000);
      setData(response);
      setError(undefined);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Geofence linkage unavailable.");
    } finally {
      setLoading(false);
    }
  }, [date, enabled, token]);

  useEffect(() => {
    if (!enabled) { setData(undefined); setError(undefined); return; }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  return { data, error, loading, refresh };
}

export function RunGeofenceRowDetails({ loadId, data, loading }: { loadId: string; data?: LinkageResponse; loading?: boolean }) {
  const stops = useMemo(() => (data?.records || []).filter(stop => stop.loadId === loadId).sort((a, b) => a.sequence - b.sequence), [data, loadId]);
  if (!stops.length) return loading ? <div className="ops-row-geofence loading">Geofence linkage loading…</div> : null;

  const linked = stops.filter(stop => stop.geofenceLinked).length;
  const hits = stops.filter(stop => stop.visitRecorded).length;
  return <details className="ops-row-geofence">
    <summary>
      <strong>Geofences {linked}/{stops.length} linked</strong>
      <span>{hits} hit{hits === 1 ? "" : "s"} · open for time in / time out</span>
    </summary>
    <div className="ops-row-geofence-stops">
      {stops.map(stop => <div className={`ops-row-geofence-stop ${stop.visitRecorded ? "hit" : ""} ${!stop.geofenceLinked ? "needs-link" : ""}`} key={stop.stopId}>
        <span className="stop-name"><b>{stop.sequence}. {stop.stopName}</b><small>{stop.geofenceName || stop.siteName || "Geofence not resolved"}</small></span>
        <span><small>Status</small><b>{state(stop)}</b></span>
        <span><small>Time in</small><b>{time(stop.latestEnterUtc)}</b></span>
        <span><small>Time out</small><b>{time(stop.latestExitUtc)}</b></span>
      </div>)}
    </div>
  </details>;
}
