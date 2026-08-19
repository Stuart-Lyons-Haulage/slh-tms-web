import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type ViewMode = "outstanding" | "ordered" | "planned";
type Allocation = { loadId: string; loadReference?: string; pallets: number; updatedAtUtc: string; updatedBy?: string };
type PlanningOrder = {
  id: string; reference: string; customerCode: string; collectionDate: string; deliveryDate?: string;
  deliveryWindowStartUtc?: string; deliveryWindowEndUtc?: string; orderedPallets: number; plannedPallets: number;
  outstandingPallets: number; overplannedPallets: number; collection: string; destination: string; planningGroup: string;
  temperature?: string; source?: string; receivedAtUtc: string; lateAddition: boolean; allocations: Allocation[];
};
type PlanningCell = { planningGroup: string; destination: string; ordered: number; planned: number; outstanding: number; overplanned: number; orderIds: string[] };
type PlanningRun = { id: string; reference: string; status: string; palletSpacesUsed?: number; totalPalletSpaces?: number; stopCount: number };
type PlanningControlData = {
  date: string; generatedAtUtc: string;
  summary: { ordered: number; planned: number; outstanding: number; overplanned: number; lateAdditions: number; orders: number; runs: number };
  planningGroups: string[]; destinations: string[]; cells: PlanningCell[]; orders: PlanningOrder[]; runs: PlanningRun[];
};
type RegionData = { date: string; destinations: string[]; destinationRegions: Record<string, string> };

function planningDate() { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function ukDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function fmtTime(value?: string) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }

export function PalletPlanningControl() {
  const token = useAccessToken();
  const [date, setDate] = useState(planningDate());
  const [mode, setMode] = useState<ViewMode>("outstanding");
  const [selectedCell, setSelectedCell] = useState<{ group: string; destination: string }>();
  const [message, setMessage] = useState<string>();
  const [busyKey, setBusyKey] = useState<string>();
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, { loadId: string; pallets: string }>>({});
  const control = useApi(useCallback(async () => request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, await token()), [date, token]));
  const regions = useApi(useCallback(async () => request<RegionData>(`/api/v1/planning-control/regions?date=${encodeURIComponent(date)}`, await token()), [date, token]));
  const refreshControl = control.refresh;
  const refreshRegions = regions.refresh;

  useEffect(() => {
    const id = window.setInterval(() => { void refreshControl(); void refreshRegions(); }, 5000);
    return () => window.clearInterval(id);
  }, [refreshControl, refreshRegions]);

  const data = control.data;
  const orderedDestinations = useMemo(() => {
    if (!data) return [];
    const live = new Set(data.destinations);
    const ranked = (regions.data?.destinations || []).filter((destination) => live.has(destination));
    const missing = data.destinations.filter((destination) => !ranked.includes(destination));
    return [...ranked, ...missing];
  }, [data, regions.data]);
  const regionGroups = useMemo(() => {
    const groups: Array<{ region: string; destinations: string[] }> = [];
    for (const destination of orderedDestinations) {
      const region = regions.data?.destinationRegions?.[destination] || "Other";
      const last = groups[groups.length - 1];
      if (last?.region === region) last.destinations.push(destination);
      else groups.push({ region, destinations: [destination] });
    }
    return groups;
  }, [orderedDestinations, regions.data]);
  const cellMap = useMemo(() => new Map((data?.cells || []).map((cell) => [`${cell.planningGroup}|||${cell.destination}`, cell])), [data?.cells]);
  const selectedOrders = useMemo(() => !data || !selectedCell ? [] : data.orders.filter((order) => order.planningGroup === selectedCell.group && order.destination === selectedCell.destination), [data, selectedCell]);
  const metric = (cell?: PlanningCell) => mode === "ordered" ? cell?.ordered || 0 : mode === "planned" ? cell?.planned || 0 : cell?.outstanding || 0;
  const showCell = (cell?: PlanningCell) => mode !== "outstanding" || (cell?.outstanding || 0) > 0 || (cell?.overplanned || 0) > 0;

  async function saveAllocation(order: PlanningOrder) {
    const draftValue = allocationDrafts[order.id] || { loadId: order.allocations[0]?.loadId || data?.runs[0]?.id || "", pallets: String(order.outstandingPallets || order.orderedPallets) };
    if (!draftValue.loadId) { setMessage("Select a run before allocating pallets."); return; }
    const pallets = Number(draftValue.pallets);
    if (!Number.isInteger(pallets) || pallets < 0) { setMessage("Enter a whole pallet quantity of zero or more."); return; }
    setBusyKey(order.id); setMessage(undefined);
    try {
      const result = await request<{ outstandingPallets: number; overplannedPallets: number; loadReference: string }>("/api/v1/planning-control/allocations", await token(), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id, loadId: draftValue.loadId, date, pallets, note: "Updated from live Pallet Control" }),
      });
      setMessage(`${order.reference}: ${pallets} pallet${pallets === 1 ? "" : "s"} allocated. ${result.outstandingPallets} remaining${result.overplannedPallets > 0 ? ` · ${result.overplannedPallets} over-planned` : ""}.`);
      await refreshControl();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The pallet allocation could not be saved."); }
    finally { setBusyKey(undefined); }
  }

  function draft(order: PlanningOrder) {
    return allocationDrafts[order.id] || { loadId: order.allocations[0]?.loadId || data?.runs[0]?.id || "", pallets: String(order.allocations[0]?.pallets ?? order.outstandingPallets ?? order.orderedPallets) };
  }

  return <section>
    <div className="title-row"><div><p className="eyebrow">Planner second screen · live quantity control</p><h1>Pallet control</h1><p className="intro">The TMS equivalent of the Pallet Order sheet. It opens on the next planning day by default. Collection rows and delivery columns are created only from live orders for the selected date; delivery sites are grouped regionally to make North, Midlands, East, London, South and West work easier to scan.</p></div><div className="title-actions"><label>Planning date <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSelectedCell(undefined); }} /></label><button onClick={() => { void refreshControl(); void refreshRegions(); }} disabled={control.loading}>Refresh</button><Link className="button-like primary" to="/">Open planner</Link></div></div>
    {message && <p className="notice inline-notice">{message}</p>}{control.error && <p className="notice inline-notice">{control.error}</p>}
    {data && data.summary.orders === 0 && <div className="state">No pallet orders are available for {ukDate(date)}. Check the planning date or Order Review if you expected work here.</div>}
    {data && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, margin: "14px 0" }}>{[["Ordered", data.summary.ordered], ["Planned", data.summary.planned], ["Outstanding", data.summary.outstanding], ["Over-planned", data.summary.overplanned], ["Late additions", data.summary.lateAdditions]].map(([label, value]) => <div key={String(label)} className="panel" style={{ padding: 12 }}><small>{label}</small><div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{value}</div></div>)}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}><strong>{ukDate(date)}</strong>{(["outstanding", "ordered", "planned"] as ViewMode[]).map((item) => <button key={item} className={mode === item ? "primary" : ""} onClick={() => setMode(item)}>{item === "outstanding" ? "Outstanding" : item === "ordered" ? "Original orders" : "Planned"}</button>)}<span style={{ marginLeft: "auto" }}><small>Auto-refreshes every 5 seconds · {data.summary.orders} orders · {data.summary.runs} runs</small></span></div>
      <div className="master-table-wrap" style={{ overflow: "auto", maxHeight: "65vh", border: "1px solid #d5e0e4", borderRadius: 8 }}><table className="master-table" style={{ minWidth: Math.max(1050, 210 + orderedDestinations.length * 92), borderCollapse: "separate", borderSpacing: 0 }}><thead>
        <tr><th style={{ position: "sticky", left: 0, zIndex: 5, background: "#dfeaed" }}>Region</th>{regionGroups.map((group) => <th key={group.region} colSpan={group.destinations.length} style={{ textAlign: "center", background: "#dfeaed", fontWeight: 900 }}>{group.region}</th>)}<th style={{ background: "#dfeaed" }} /></tr>
        <tr><th style={{ position: "sticky", left: 0, zIndex: 4, minWidth: 210, background: "#eef4f5" }}>Collection site</th>{orderedDestinations.map((destination) => <th key={destination} style={{ minWidth: 88, writingMode: "vertical-rl", transform: "rotate(180deg)", height: 150 }}>{destination}</th>)}<th style={{ minWidth: 90 }}>Total</th></tr>
      </thead><tbody>
        {data.planningGroups.map((group) => { const groupCells = orderedDestinations.map((destination) => cellMap.get(`${group}|||${destination}`)); const rowTotal = groupCells.reduce((sum, cell) => sum + metric(cell), 0); if (mode === "outstanding" && rowTotal === 0 && !groupCells.some((cell) => (cell?.overplanned || 0) > 0)) return null; return <tr key={group}><td style={{ position: "sticky", left: 0, zIndex: 2, background: "white", fontWeight: 700 }}>{group}</td>{orderedDestinations.map((destination, index) => { const cell = groupCells[index]; const number = metric(cell); const over = cell?.overplanned || 0; return <td key={destination} style={{ textAlign: "center", padding: 3 }}>{showCell(cell) && (number > 0 || over > 0) ? <button type="button" onClick={() => setSelectedCell({ group, destination })} title={`${group} → ${destination}: ${cell?.ordered || 0} ordered, ${cell?.planned || 0} planned, ${cell?.outstanding || 0} outstanding`} style={{ width: "100%", minHeight: 38, fontWeight: 800, border: over > 0 ? "2px solid #b42318" : number === 0 ? "1px solid #b7c6cc" : undefined, background: over > 0 ? "#fff1f0" : mode === "outstanding" ? "#fff8e9" : undefined }}>{number}{over > 0 && <small style={{ display: "block", color: "#b42318" }}>+{over}</small>}</button> : ""}</td>; })}<td style={{ textAlign: "center", fontWeight: 800 }}>{rowTotal}</td></tr>; })}
        <tr><td style={{ position: "sticky", left: 0, background: "#eef4f5", fontWeight: 800 }}>Destination total</td>{orderedDestinations.map((destination) => { const total = data.planningGroups.reduce((sum, group) => sum + metric(cellMap.get(`${group}|||${destination}`)), 0); return <td key={destination} style={{ textAlign: "center", fontWeight: 800 }}>{total || ""}</td>; })}<td style={{ textAlign: "center", fontWeight: 900 }}>{mode === "ordered" ? data.summary.ordered : mode === "planned" ? data.summary.planned : data.summary.outstanding}</td></tr>
      </tbody></table></div>
      {selectedCell && <div className="panel" style={{ marginTop: 16 }}><div className="title-row"><div><p className="eyebrow">Underlying orders</p><h2>{selectedCell.group} → {selectedCell.destination}</h2><p>Original order quantities are never overwritten. Change the quantity against a run to move or split work.</p></div><button onClick={() => setSelectedCell(undefined)}>Close</button></div><div style={{ overflowX: "auto" }}><table className="master-table" style={{ minWidth: 1250 }}><thead><tr><th>Order</th><th>Customer</th><th>Collection</th><th>Destination</th><th>Temp</th><th>Ordered</th><th>Planned</th><th>Remaining</th><th>Received</th><th>Source</th><th>Run allocation</th></tr></thead><tbody>{selectedOrders.map((order) => { const d = draft(order); return <tr key={order.id}><td><strong>{order.reference}</strong>{order.lateAddition && <><br/><small style={{ color: "#0969da", fontWeight: 700 }}>NEW AFTER PLANNING STARTED</small></>}</td><td>{order.customerCode}</td><td>{order.collection}</td><td>{order.destination}</td><td>{order.temperature || "—"}</td><td style={{ textAlign: "center" }}>{order.orderedPallets}</td><td style={{ textAlign: "center" }}>{order.plannedPallets}</td><td style={{ textAlign: "center", fontWeight: 800, color: order.overplannedPallets > 0 ? "#b42318" : undefined }}>{order.outstandingPallets}{order.overplannedPallets > 0 ? ` (+${order.overplannedPallets} over)` : ""}</td><td>{fmtTime(order.receivedAtUtc)}</td><td>{order.source || "TMS order"}</td><td><div style={{ display: "grid", gridTemplateColumns: "minmax(150px,1fr) 80px auto", gap: 6, alignItems: "center" }}><select value={d.loadId} onChange={(e) => setAllocationDrafts((current) => ({ ...current, [order.id]: { ...d, loadId: e.target.value } }))}><option value="">Select run…</option>{data.runs.map((run) => <option key={run.id} value={run.id}>{run.reference} · {run.palletSpacesUsed ?? 0}/{run.totalPalletSpaces ?? 26}</option>)}</select><input type="number" min="0" step="1" value={d.pallets} onChange={(e) => setAllocationDrafts((current) => ({ ...current, [order.id]: { ...d, pallets: e.target.value } }))} /><button className="primary" disabled={busyKey === order.id} onClick={() => void saveAllocation(order)}>{busyKey === order.id ? "Saving…" : "Save"}</button></div>{order.allocations.length > 0 && <small style={{ display: "block", marginTop: 5 }}>{order.allocations.map((a) => `${a.loadReference || "Run"}: ${a.pallets}`).join(" · ")}</small>}</td></tr>; })}</tbody></table></div></div>}
    </>}
  </section>;
}
