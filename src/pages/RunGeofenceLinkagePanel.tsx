import { useCallback, useEffect, useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";

type LinkageRecord = {
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
  evidence?: string;
};
type LinkageResponse = {
  linkedStops: number;
  stops: number;
  siteNameUnresolved: number;
  siteMatchedButGeofenceUnlinked: number;
  records: LinkageRecord[];
};

function evidenceState(stop: LinkageRecord) {
  if (!stop.geofenceLinked) return stop.siteMatched ? "NO GEOFENCE" : "SITE UNRESOLVED";
  if (stop.latestExitUtc) return "DEPARTED";
  if (stop.visitRecorded) return "HIT";
  return "LINKED · NO HIT";
}

export function RunGeofenceLinkagePanel() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const [data, setData] = useState<LinkageResponse>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const access = await token();
      const response = await request<LinkageResponse>(`/api/v1/planning/geofence-linkage?date=${encodeURIComponent(date)}`, access);
      setData(response);
      setError(undefined);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Geofence linkage diagnostics unavailable.");
    }
  }, [date, token]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runs = useMemo(() => {
    const grouped = new Map<string, LinkageRecord[]>();
    for (const record of data?.records || []) {
      const rows = grouped.get(record.loadId) || [];
      rows.push(record);
      grouped.set(record.loadId, rows);
    }
    return [...grouped.values()].map(stops => ({
      loadId: stops[0].loadId,
      run: stops[0].run,
      stops: [...stops].sort((a, b) => a.sequence - b.sequence),
      linked: stops.filter(stop => stop.geofenceLinked).length,
      hits: stops.filter(stop => stop.visitRecorded).length,
    }));
  }, [data]);

  return <section className="ops-linkage-panel" aria-label="Run geofence linkage">
    <div className="ops-linkage-summary">
      <div><strong>Geofence linkage</strong><span>Run Progress configuration + RoadTech evidence</span></div>
      {data && <div><b>{data.linkedStops}/{data.stops} stops linked</b><span>{data.siteNameUnresolved + data.siteMatchedButGeofenceUnlinked} need attention</span></div>}
    </div>
    {error && <p className="ops-linkage-error">{error}</p>}
    <div className="ops-linkage-runs">
      {runs.map(run => <details key={run.loadId} className={run.linked < run.stops.length ? "needs-link" : ""}>
        <summary><strong>{run.run}</strong><span>{run.linked}/{run.stops.length} linked · {run.hits} hit</span></summary>
        <div className="ops-linkage-stops">
          {run.stops.map(stop => <div key={stop.stopId} className={!stop.geofenceLinked ? "needs-link" : ""}>
            <b>{stop.sequence}. {stop.stopName}</b>
            <span>{evidenceState(stop)}</span>
            <small>{stop.geofenceLinked ? stop.geofenceName : stop.siteMatched ? `${stop.siteName || stop.stopName} · geofence not linked` : "No Site Master match"}</small>
            {stop.latestEnterUtc && <small>Arrival {new Date(stop.latestEnterUtc).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}{stop.latestExitUtc ? ` · departure ${new Date(stop.latestExitUtc).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</small>}
          </div>)}
        </div>
      </details>)}
    </div>
  </section>;
}
