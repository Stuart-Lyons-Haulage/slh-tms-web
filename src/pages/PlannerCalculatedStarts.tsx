import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { subscribePlanningChanges } from "../lib/planningEvents";

type StartSuggestion = {
  loadId: string;
  runReference: string;
  driverName?: string;
  existingStartUtc?: string;
  existingStartSource?: string;
  legalRestCompleteUtc?: string;
  suggestedStartUtc?: string;
  walkaroundMinutes: number;
  origin?: string;
  travelMinutes?: number;
  firstCollectionEtaUtc?: string;
  firstCollection?: string;
  latestOnSite?: string;
  restType: string;
  explanation: string;
};
type Response = { planningDate: string; walkaroundMinutes: number; rows: StartSuggestion[] };

function localTime(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function addMinutesToClock(value: string, minutes: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "";
  const total = (Number(match[1]) * 60 + Number(match[2]) + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function normaliseResponse(value: unknown, planningDate: string): Response {
  if (!value || typeof value !== "object") return { planningDate, walkaroundMinutes: 10, rows: [] };
  const record = value as Partial<Response>;
  return {
    planningDate: typeof record.planningDate === "string" ? record.planningDate : planningDate,
    walkaroundMinutes: typeof record.walkaroundMinutes === "number" ? record.walkaroundMinutes : 10,
    rows: Array.isArray(record.rows) ? record.rows : [],
  };
}

export function PlannerCalculatedStarts({ planningDate }: { planningDate: string }) {
  const token = useAccessToken();
  const [data, setData] = useState<Response>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const applied = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const payload = await request<unknown>(`/api/v1/planner-starts?date=${encodeURIComponent(planningDate)}`, await token());
    const next = normaliseResponse(payload, planningDate);
    setData(next);
    setDrafts((current) => {
      const updated = { ...current };
      for (const row of next.rows) {
        if (!(row.loadId in updated)) updated[row.loadId] = localTime(row.existingStartUtc || row.suggestedStartUtc);
      }
      return updated;
    });
    return next;
  }, [planningDate, token]);

  useEffect(() => {
    applied.current.clear();
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Calculated starts could not be loaded."));
    const unsubscribe = subscribePlanningChanges(() => void refresh().catch(() => undefined));
    return unsubscribe;
  }, [refresh]);

  const rows = useMemo(() => Array.isArray(data?.rows) ? data.rows : [], [data]);

  useEffect(() => {
    const pending = rows.filter((row) => row.suggestedStartUtc && !row.existingStartUtc && !applied.current.has(row.loadId));
    if (!pending.length) return;
    for (const row of pending) applied.current.add(row.loadId);
    void (async () => {
      try {
        const access = await token();
        await Promise.all(pending.map((row) => request(`/api/v1/planner-starts/${row.loadId}/apply`, access, { method: "PUT" })));
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "A calculated start could not be auto-saved.");
      }
    })();
  }, [refresh, rows, token]);

  async function saveManual(row: StartSuggestion) {
    const value = (drafts[row.loadId] || "").trim();
    if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      setMessage("Start time must be HH:mm.");
      return;
    }
    setBusy(row.loadId);
    try {
      await request(`/api/v1/driver-dispatch/${row.loadId}/start-time`, await token(), {
        method: "PUT",
        body: JSON.stringify({ startTime: value || null }),
      });
      setMessage(`${row.runReference} start saved${value ? " as a manual override" : ""}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Start time could not be saved.");
    } finally {
      setBusy(undefined);
    }
  }

  async function recalculate(row: StartSuggestion) {
    setBusy(row.loadId);
    try {
      await request(`/api/v1/planner-starts/${row.loadId}/apply`, await token(), { method: "PUT" });
      setMessage(`${row.runReference} recalculated from Tacho, walkaround and routing evidence.`);
      setDrafts((current) => {
        const updated = { ...current };
        delete updated[row.loadId];
        return updated;
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calculated start could not be applied.");
    } finally {
      setBusy(undefined);
    }
  }

  return <section className="panel" style={{ marginBottom: 14, padding: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end", marginBottom: 8 }}>
      <div><p className="eyebrow" style={{ marginBottom: 2 }}>Driver start intelligence</p><strong>Calculated Start</strong><br /><small>Tacho legal rest → 10 min walkaround → Azure Maps truck travel → first collection ETA. Start remains editable.</small></div>
      <button type="button" onClick={() => void refresh()} disabled={Boolean(busy)}>Refresh starts</button>
    </div>
    {message && <p className="notice inline-notice" style={{ marginBottom: 8 }}>{message}</p>}
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}>
        <thead><tr><th>Run</th><th>Driver</th><th>Calculated start</th><th>Rest evidence</th><th>Origin</th><th>Walkaround</th><th>First collection ETA</th><th>Latest on site</th><th /></tr></thead>
        <tbody>{rows.map((row) => {
          const source = row.existingStartSource || (row.existingStartUtc ? "Manual override" : "Calculated");
          const startDraft = drafts[row.loadId] || "";
          const manualEta = source !== "Calculated" && startDraft && row.travelMinutes != null
            ? addMinutesToClock(startDraft, (row.walkaroundMinutes || 10) + row.travelMinutes)
            : "";
          const firstEta = manualEta || localTime(row.firstCollectionEtaUtc);
          return <tr key={row.loadId} title={row.explanation}>
            <td><strong>{row.runReference}</strong></td>
            <td>{row.driverName || <small>Not allocated</small>}</td>
            <td><div style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="time" value={startDraft} onChange={(event) => setDrafts((current) => ({ ...current, [row.loadId]: event.target.value }))} onBlur={() => void saveManual(row)} disabled={!row.driverName || busy === row.loadId} /><small>{source === "Calculated" ? "Auto" : "Manual override"}</small></div></td>
            <td><strong>{localTime(row.legalRestCompleteUtc) || "—"}</strong><br /><small>{row.restType}</small></td>
            <td>{row.origin || "—"}<br /><small>{row.travelMinutes != null ? `${row.travelMinutes} min travel` : "Route pending"}</small></td>
            <td><strong>{row.walkaroundMinutes || 10} min</strong></td>
            <td><strong>{firstEta || "—"}</strong><br /><small>{row.firstCollection || "First collection"}{manualEta ? " · from override" : ""}</small></td>
            <td><strong>{row.latestOnSite || "Not set"}</strong><br /><small>{row.latestOnSite ? "Site Master" : "Add site rule"}</small></td>
            <td><button type="button" onClick={() => void recalculate(row)} disabled={!row.suggestedStartUtc || busy === row.loadId}>Recalculate</button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {!rows.length && <p style={{ margin: 0 }}>No calculated start is available yet. The run builder remains usable while driver/Tacho/start evidence is loading or unavailable.</p>}
  </section>;
}
