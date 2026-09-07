import { useMemo } from "react";
import type { Site } from "../lib/api";
import { suggestJobsForRun, type RunSuggestionLine, type RunSuggestionOrder } from "../pages/runPlannerSuggestions";

type Props = {
  lines: RunSuggestionLine[];
  orders: RunSuggestionOrder[];
  sites: Site[];
  remainingCapacity: number;
  busy: boolean;
  onAdd: (orderId: string) => void;
};

export function RunJobSuggestions({ lines, orders, sites, remainingCapacity, busy, onAdd }: Props) {
  const suggestions = useMemo(
    () => suggestJobsForRun(lines, orders, sites, remainingCapacity),
    [lines, orders, remainingCapacity, sites],
  );
  const hasRunJob = lines.some((line) => Boolean(line.orderId));

  return <section className="run-intelligence-panel" style={{ marginTop: 12, padding: 10, border: "1px solid #d7e2e7", borderRadius: 10, background: "#fff" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 3 }}>Run suggestions</p>
        <strong>Jobs that could go with this run</strong><br />
        <small>Based on shared collections, deliveries and regional flow. Driver, vehicle and Tacho suggestions are handled in Driver Dispatch.</small>
      </div>
      <span style={{ textAlign: "right" }}><strong>{Math.max(remainingCapacity, 0)}</strong><br /><small>spaces remaining</small></span>
    </div>

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
          <small>{reasons.slice(0, 3).join(" · ")}</small>
        </span>
        <span style={{ textAlign: "right" }}><strong>{order.outstandingPallets}</strong><br /><small>pallets</small></span>
      </button>)}
    </div>}
  </section>;
}
