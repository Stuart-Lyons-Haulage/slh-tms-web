import { useEffect, useMemo, useState } from "react";
import type { Site } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { listRuns } from "../api/runs";
import { calculateRunCapacity } from "../pages/runPlannerCapacity";
import {
  buildHistoricalRouteAffinity,
  suggestJobsForRun,
  type RunHistoryAffinity,
  type RunSuggestionLine,
  type RunSuggestionOrder,
} from "../pages/runPlannerSuggestions";

type Props = {
  lines: RunSuggestionLine[];
  orders: RunSuggestionOrder[];
  sites: Site[];
  remainingCapacity?: number;
  busy: boolean;
  onAdd: (orderId: string) => void;
};

let historyPromise: Promise<Awaited<ReturnType<typeof listRuns>>> | undefined;

function loadPlanningHistory(token: string) {
  historyPromise ??= listRuns(undefined, token).catch((error) => {
    historyPromise = undefined;
    throw error;
  });
  return historyPromise;
}

function yesterdayLocal() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function RunJobSuggestions({ lines, orders, sites, busy, onAdd }: Props) {
  const accessToken = useAccessToken();
  const [history, setHistory] = useState<RunHistoryAffinity>(() => new Map());
  const [historyAvailable, setHistoryAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await accessToken();
        const runs = await loadPlanningHistory(token);
        if (cancelled) return;
        setHistory(buildHistoricalRouteAffinity(runs, sites, yesterdayLocal(), 90));
        setHistoryAvailable(true);
      } catch {
        if (!cancelled) setHistoryAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken, sites]);

  const capacity = useMemo(() => calculateRunCapacity(lines, orders), [lines, orders]);
  const suggestions = useMemo(
    () => suggestJobsForRun(
      lines,
      orders,
      sites,
      { standard: capacity.standardRemaining, euro: capacity.euroRemaining },
      6,
      history,
    ),
    [capacity.euroRemaining, capacity.standardRemaining, history, lines, orders, sites],
  );
  const hasRunJob = lines.some((line) => Boolean(line.orderId));
  const nearCapacity = capacity.status === "Green" && capacity.utilisationPercent >= 90;

  return <section className="run-intelligence-panel" style={{ marginTop: 12, padding: 10, border: "1px solid #d7e2e7", borderRadius: 10, background: "#fff" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 420px" }}>
        <p className="eyebrow" style={{ marginBottom: 3 }}>Run suggestions</p>
        <strong>Jobs that could go with this run</strong><br />
        <small>Destination-first route matching, recent planning history and regional flow. Driver, vehicle and Tacho suggestions remain in Driver Dispatch.</small>
        <div style={{ marginTop: 5 }}><small>{historyAvailable ? "Learning signal: recent completed/planned run combinations are included." : "Learning signal unavailable: live route logic is still active."}</small></div>
      </div>
      <div style={{ minWidth: 210, textAlign: "right" }}>
        <strong>Capacity</strong>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, marginTop: 4 }}>
          <span><strong>{capacity.standardRemaining}</strong><br /><small>Standard remaining</small></span>
          <span><strong>{capacity.euroRemaining}</strong><br /><small>Euro remaining</small></span>
        </div>
        <small>{capacity.utilisationPercent}% footprint used · alternatives, not additive</small>
      </div>
    </div>

    {capacity.status === "Red" && <p role="alert" style={{ margin: "10px 0 0", fontWeight: 700 }}>
      ⚠ Over capacity by {capacity.overStandardEquivalent} Standard-equivalent space{capacity.overStandardEquivalent === 1 ? "" : "s"}. Reduce the run before dispatch.
    </p>}
    {capacity.status === "Amber" && <p role="alert" style={{ margin: "10px 0 0", fontWeight: 700 }}>
      ⚠ Capacity cannot be fully confirmed because {capacity.unknownPallets} pallet{capacity.unknownPallets === 1 ? " has" : "s have"} no Standard/Euro type.
    </p>}
    {nearCapacity && <p role="alert" style={{ margin: "10px 0 0", fontWeight: 700 }}>
      ⚠ Near capacity: only {capacity.standardRemaining} Standard or {capacity.euroRemaining} Euro pallet space{Math.max(capacity.standardRemaining, capacity.euroRemaining) === 1 ? "" : "s"} remain.
    </p>}

    {!hasRunJob && <p style={{ margin: "10px 0 0" }}><small>Add the first order to this run and compatible jobs will appear here.</small></p>}
    {hasRunJob && suggestions.length === 0 && <p style={{ margin: "10px 0 0" }}><small>No strong companion jobs are currently outstanding. Check Orders to Plan for the full pool.</small></p>}

    {suggestions.length > 0 && <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
      {suggestions.map(({ order, reasons }) => <button
        key={order.id}
        type="button"
        disabled={busy}
        onClick={(event) => { event.stopPropagation(); onAdd(order.id); }}
        style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", width: "100%", textAlign: "left" }}
      >
        <span>
          <strong>{order.collection} → {order.destination}</strong><br />
          <small>{reasons.slice(0, 4).join(" · ")}</small>
        </span>
        <span style={{ textAlign: "right" }}><strong>{order.outstandingPallets}</strong><br /><small>{order.palletType || "Unmapped"} pallets</small></span>
      </button>)}
    </div>}
  </section>;
}
