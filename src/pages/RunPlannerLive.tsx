import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, request, type Load, type Site } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../simple-planner.css";

type Period = "" | "AM" | "PM";
type Allocation = { loadId: string; loadReference?: string; pallets: number };
type PlanningOrder = {
  id: string;
  reference: string;
  customerCode: string;
  orderedPallets: number;
  plannedPallets: number;
  outstandingPallets: number;
  collection: string;
  destination: string;
  allocations: Allocation[];
};
type PlanningControlData = {
  date: string;
  generatedAtUtc: string;
  orders: PlanningOrder[];
  summary: { ordered: number; planned: number; outstanding: number };
};
type AllocationResult = {
  orderId: string;
  loadId: string;
  allocatedToRun: number;
  plannedPallets: number;
  orderedPallets: number;
  outstandingPallets: number;
  overplannedPallets: number;
};
type RunLine = {
  key: string;
  orderId?: string;
  collectionSite: string;
  deliverySite: string;
  pallets: string;
};
type RunDraft = { key: string; loadId?: string; period: Period; lines: RunLine[] };

const blankLine = (): RunLine => ({ key: crypto.randomUUID(), collectionSite: "", deliverySite: "", pallets: "" });
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const normalise = (v: unknown) => String(v ?? "").trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
const tagged = (notes: string | undefined, label: string) => (notes || "")
  .split("·")
  .map((x) => x.trim())
  .find((x) => x.toLowerCase().startsWith(`${label}:`.toLowerCase()))
  ?.slice(label.length + 1)
  .trim() || "";
const periodFromLoad = (load: Load): Period => {
  const p = tagged(load.plannerNotes, "Planner period").toUpperCase();
  return p === "AM" || p === "PM" ? p : "";
};
const withPlannerPeriod = (notes: string | undefined, period: Period) => {
  const parts = (notes || "").split("·").map((part) => part.trim()).filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith("planner period:"));
  return period ? [`Planner period: ${period}`, ...parts].join(" · ") : parts.join(" · ");
};
const siteAddress = (sites: Site[], value: string) => sites.find((site) =>
  [site.name, site.driverTextName, site.externalCode, ...(site.aliases || "").split(/[,;|]/)]
    .some((x) => normalise(x) === normalise(value)))?.collectionAddress;
const runRef = (date: string, n: number) => `RUN-${date.replaceAll("-", "")}-${String(n).padStart(2, "0")}`;

function validPallets(value: string) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function notifyPlanningChanged(date: string) {
  window.dispatchEvent(new CustomEvent("slh:planning-changed", { detail: { date } }));
  try {
    localStorage.setItem("slh:planning-pulse", JSON.stringify({ date, at: Date.now() }));
  } catch { /* storage can be unavailable in private browsing */ }
  try {
    const channel = new BroadcastChannel("slh-planning");
    channel.postMessage({ type: "allocation-changed", date, at: Date.now() });
    channel.close();
  } catch { /* BroadcastChannel is an enhancement, not a dependency */ }
}

export function RunPlannerLive() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const [control, setControl] = useState<PlanningControlData>();
  const [loads, setLoads] = useState<Load[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [runs, setRuns] = useState<RunDraft[]>([{ key: `shell-${localDate()}-1`, period: "", lines: [blankLine()] }]);
  const [activeKey, setActiveKey] = useState(runs[0].key);
  const [busyKey, setBusyKey] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [query, setQuery] = useState("");
  const saveTimers = useRef<Record<string, number>>({});
  const mutationCounter = useRef(0);

  const hydrate = useCallback((nextControl: PlanningControlData, nextLoads: Load[]) => {
    const ordered = [...nextLoads].sort((a, b) => String(a.reference).localeCompare(String(b.reference)));
    if (!ordered.length) {
      const shell: RunDraft = { key: `shell-${date}-1`, period: "", lines: [blankLine()] };
      setRuns([shell]);
      setActiveKey(shell.key);
      return;
    }
    const drafts = ordered.map((load) => {
      const lines = nextControl.orders.flatMap((order) => {
        const allocation = order.allocations.find((a) => a.loadId === load.id && a.pallets > 0);
        return allocation ? [{
          key: `${load.id}-${order.id}`,
          orderId: order.id,
          collectionSite: order.collection,
          deliverySite: order.destination,
          pallets: String(allocation.pallets),
        }] : [];
      });
      return {
        key: load.id,
        loadId: load.id,
        period: periodFromLoad(load),
        lines: lines.length ? lines : [blankLine()],
      } satisfies RunDraft;
    });
    setRuns(drafts);
    setActiveKey((current) => drafts.some((r) => r.key === current) ? current : drafts[0].key);
  }, [date]);

  const refreshAll = useCallback(async () => {
    const access = await token();
    const [nextControl, nextLoads, nextSites] = await Promise.all([
      request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}&_=${Date.now()}`, access),
      api.loads(date, access),
      api.sites(access),
    ]);
    const safeLoads = Array.isArray(nextLoads) ? nextLoads : [];
    setControl(nextControl);
    setLoads(safeLoads);
    setSites(Array.isArray(nextSites) ? nextSites : []);
    hydrate(nextControl, safeLoads);
  }, [date, hydrate, token]);

  const refreshControl = useCallback(async () => {
    const next = await request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}&_=${Date.now()}`, await token());
    setControl(next);
  }, [date, token]);

  useEffect(() => {
    void refreshAll().catch((error) => setMessage(error instanceof Error ? error.message : "Planner data could not be refreshed."));
    return () => {
      Object.values(saveTimers.current).forEach((id) => window.clearTimeout(id));
      saveTimers.current = {};
    };
  }, [refreshAll]);

  // Keep order amendments and another planner/Pallet Control tab visible without rebuilding
  // the run currently being edited. The run draft is the immediate source of truth for local
  // pallet balances; the server control snapshot reconciles every two seconds.
  useEffect(() => {
    const refresh = () => void refreshControl().catch(() => undefined);
    const interval = window.setInterval(refresh, 2000);
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ date?: string }>).detail;
      if (!detail?.date || detail.date === date) refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "slh:planning-pulse" || !event.newValue) return;
      try { if (JSON.parse(event.newValue).date === date) refresh(); } catch { /* ignore malformed pulse */ }
    };
    window.addEventListener("slh:planning-changed", onChanged);
    window.addEventListener("storage", onStorage);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("slh-planning");
      channel.onmessage = (event) => { if (!event.data?.date || event.data.date === date) refresh(); };
    } catch { /* polling remains available */ }
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("slh:planning-changed", onChanged);
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [date, refreshControl]);

  const orders = useMemo(() => control?.orders || [], [control]);
  const effectiveOrders = useMemo(() => {
    const localByOrder = new Map<string, number>();
    const localLoadIds = new Set(runs.flatMap((run) => run.loadId ? [run.loadId] : []));
    for (const run of runs) {
      for (const line of run.lines) {
        if (!line.orderId) continue;
        const quantity = validPallets(line.pallets) ?? 0;
        localByOrder.set(line.orderId, (localByOrder.get(line.orderId) || 0) + quantity);
      }
    }
    return orders.map((order) => {
      const outsideLocalRuns = order.allocations
        .filter((allocation) => !localLoadIds.has(allocation.loadId))
        .reduce((sum, allocation) => sum + Math.max(allocation.pallets, 0), 0);
      const locallyPlanned = localByOrder.get(order.id) || 0;
      const plannedPallets = outsideLocalRuns + locallyPlanned;
      return {
        ...order,
        plannedPallets,
        outstandingPallets: Math.max(order.orderedPallets - plannedPallets, 0),
      };
    });
  }, [orders, runs]);

  const summary = useMemo(() => effectiveOrders.reduce((totals, order) => ({
    ordered: totals.ordered + order.orderedPallets,
    planned: totals.planned + order.plannedPallets,
    outstanding: totals.outstanding + order.outstandingPallets,
  }), { ordered: 0, planned: 0, outstanding: 0 }), [effectiveOrders]);

  const visible = useMemo(() => effectiveOrders
    .filter((o) => o.outstandingPallets > 0)
    .filter((o) => !query.trim() || [o.reference, o.customerCode, o.collection, o.destination]
      .some((v) => String(v).toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => a.collection.localeCompare(b.collection) || a.destination.localeCompare(b.destination)), [effectiveOrders, query]);

  const active = runs.find((r) => r.key === activeKey) || runs[0];
  const updateRun = (key: string, fn: (r: RunDraft) => RunDraft) => setRuns((current) => current.map((r) => r.key === key ? fn(r) : r));
  const updateLine = (runKey: string, lineKey: string, patch: Partial<RunLine>) => updateRun(runKey, (r) => ({
    ...r,
    lines: r.lines.map((l) => l.key === lineKey ? { ...l, ...patch } : l),
  }));

  function runTotal(run: RunDraft) {
    return run.lines.reduce((sum, line) => sum + (validPallets(line.pallets) || 0), 0);
  }

  function buildStops(lines: RunLine[]) {
    return lines.filter((line) => line.orderId && validPallets(line.pallets)! > 0).flatMap((line) => [
      { name: `Collect · ${line.collectionSite}`, address: siteAddress(sites, line.collectionSite) },
      { orderId: line.orderId, name: `Deliver · ${line.deliverySite}`, address: siteAddress(sites, line.deliverySite) },
    ]);
  }

  async function allocate(orderId: string, loadId: string, pallets: number, access: string) {
    return request<AllocationResult>("/api/v1/planning-control/allocations", access, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, loadId, date, pallets, note: "Auto-saved from live Run Planner" }),
    });
  }

  async function syncStops(loadId: string, lines: RunLine[], access: string) {
    const stops = buildStops(lines);
    if (stops.length === 0) {
      // New API revisions allow an empty stop list while a load is still Draft. Older
      // revisions may reject this; allocation zero remains authoritative either way.
      try { await api.updateLoadStops(loadId, [], access); } catch { /* safe compatibility fallback */ }
      return;
    }
    await api.updateLoadStops(loadId, stops, access);
  }

  async function persistPeriod(run: RunDraft, period: Period) {
    if (!run.loadId) return;
    const load = loads.find((item) => item.id === run.loadId);
    try {
      await request(`/api/v1/loads/${run.loadId}/utilisation`, await token(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          palletSpacesUsed: runTotal({ ...run, period }),
          totalPalletSpaces: load?.totalPalletSpaces ?? 26,
          capacityType: load?.capacityType ?? "Standard pallets",
          depotSplits: load?.depotSplits,
          temperatureC: load?.temperatureC,
          plannerNotes: withPlannerPeriod(load?.plannerNotes, period),
        }),
      });
      notifyPlanningChanged(date);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Run period could not be auto-saved.");
    }
  }

  function maxForOrder(orderId: string, runKey: string) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return 0;
    const plannedOnOtherRuns = runs.filter((run) => run.key !== runKey)
      .flatMap((run) => run.lines)
      .filter((line) => line.orderId === orderId)
      .reduce((sum, line) => sum + (validPallets(line.pallets) || 0), 0);
    const representedLoadIds = new Set(runs.flatMap((run) => run.loadId ? [run.loadId] : []));
    const serverOutsidePlanner = order.allocations
      .filter((allocation) => !representedLoadIds.has(allocation.loadId))
      .reduce((sum, allocation) => sum + Math.max(allocation.pallets, 0), 0);
    return Math.max(order.orderedPallets - plannedOnOtherRuns - serverOutsidePlanner, 0);
  }

  async function persistQuantity(runKey: string, lineKey: string, orderId: string, loadId: string, pallets: number) {
    const mutation = ++mutationCounter.current;
    setBusyKey(`${runKey}:${lineKey}`);
    try {
      const access = await token();
      await allocate(orderId, loadId, pallets, access);
      notifyPlanningChanged(date);
      setMessage(`Auto-saved · ${pallets} pallet${pallets === 1 ? "" : "s"} on this run.`);
      void refreshControl().catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pallet quantity could not be auto-saved.");
      // Only rehydrate if this is still the newest mutation. This prevents an older failed
      // request from undoing a later successful edit.
      if (mutation === mutationCounter.current) void refreshAll();
    } finally {
      setBusyKey((current) => current === `${runKey}:${lineKey}` ? undefined : current);
    }
  }

  function scheduleQuantity(run: RunDraft, line: RunLine, value: string) {
    updateLine(run.key, line.key, { pallets: value });
    if (!line.orderId || !run.loadId) return;
    const pallets = validPallets(value);
    if (pallets === undefined) return;
    const maximum = maxForOrder(line.orderId, run.key);
    if (pallets > maximum) {
      setMessage(`Maximum available for this run is ${maximum} pallets. The remaining quantity is controlled by the live order balance.`);
      return;
    }
    const timerKey = `${run.key}:${line.key}`;
    if (saveTimers.current[timerKey]) window.clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = window.setTimeout(() => {
      delete saveTimers.current[timerKey];
      void persistQuantity(run.key, line.key, line.orderId!, run.loadId!, pallets);
    }, 450);
  }

  async function addOrder(order: PlanningOrder) {
    if (!active || order.outstandingPallets <= 0 || busyKey) return;
    if (active.lines.some((line) => line.orderId === order.id)) {
      setMessage(`${order.collection} → ${order.destination} is already on this run. Amend its pallet quantity in the run line.`);
      return;
    }

    const newLine: RunLine = {
      key: crypto.randomUUID(),
      orderId: order.id,
      collectionSite: order.collection,
      deliverySite: order.destination,
      pallets: String(order.outstandingPallets),
    };
    let nextLines: RunLine[] = [];
    updateRun(active.key, (run) => {
      const blank = run.lines.findIndex((line) => !line.orderId && !line.collectionSite && !line.deliverySite && !line.pallets);
      if (blank >= 0) {
        nextLines = [...run.lines];
        nextLines[blank] = newLine;
      } else nextLines = [...run.lines, newLine];
      return { ...run, lines: nextLines };
    });

    setBusyKey(active.key);
    try {
      const access = await token();
      let loadId = active.loadId;
      if (!loadId) {
        const index = runs.findIndex((run) => run.key === active.key);
        const created = await api.createLoad({
          reference: runRef(date, Math.max(index + 1, 1)),
          planningDate: date,
          palletSpacesUsed: order.outstandingPallets,
          totalPalletSpaces: 26,
          capacityType: "Standard pallets",
          plannerNotes: active.period ? `Planner period: ${active.period}` : undefined,
          stops: buildStops(nextLines),
        }, access);
        loadId = created.id;
        setLoads((current) => current.some((load) => load.id === created.id) ? current : [...current, created]);
        updateRun(active.key, (run) => ({ ...run, loadId }));
      }
      await allocate(order.id, loadId, order.outstandingPallets, access);
      await syncStops(loadId, nextLines, access);
      notifyPlanningChanged(date);
      setMessage(`${order.outstandingPallets} pallet${order.outstandingPallets === 1 ? "" : "s"} added and auto-saved. Any balance remains in Orders to Plan.`);
      void refreshControl().catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order could not be added to the run.");
      await refreshAll().catch(() => undefined);
    } finally {
      setBusyKey(undefined);
    }
  }

  async function clearLine(run: RunDraft, line: RunLine) {
    const remaining = run.lines.length === 1 ? [blankLine()] : run.lines.filter((item) => item.key !== line.key);
    updateRun(run.key, (current) => ({ ...current, lines: remaining }));
    if (!line.orderId || !run.loadId) return;
    setBusyKey(`${run.key}:${line.key}`);
    try {
      const access = await token();
      await allocate(line.orderId, run.loadId, 0, access);
      await syncStops(run.loadId, remaining, access);
      notifyPlanningChanged(date);
      setMessage("Order removed from the run and its pallets returned to Orders to Plan.");
      void refreshControl().catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order could not be removed from the run.");
      await refreshAll().catch(() => undefined);
    } finally {
      setBusyKey(undefined);
    }
  }

  return <section className="simple-planner">
    <div className="simple-planner-toolbar">
      <label>Plan date <input type="date" value={date} onChange={(event) => {
        setDate(event.target.value);
        setMessage(undefined);
        const shell: RunDraft = { key: `shell-${event.target.value}-1`, period: "", lines: [blankLine()] };
        setRuns([shell]);
        setActiveKey(shell.key);
      }} /></label>
      <button onClick={() => void refreshAll()} disabled={Boolean(busyKey)}>Refresh</button>
      <button className="primary" onClick={() => {
        const draft: RunDraft = { key: `shell-${date}-${crypto.randomUUID()}`, period: "", lines: [blankLine()] };
        setRuns((current) => [...current, draft]);
        setActiveKey(draft.key);
      }}>+ Add run</button>
      <div className="simple-planner-summary">
        <span><strong>{summary.planned}</strong><small>planned</small></span>
        <span><strong>{summary.outstanding}</strong><small>remaining</small></span>
      </div>
    </div>

    {message && <p className="notice inline-notice simple-planner-notice">{message}</p>}

    <div className="simple-planner-layout">
      <div className="simple-run-builder">
        <div className="simple-section-heading">
          <div><p className="eyebrow">Run builder</p><h2>{runs.length} run{runs.length === 1 ? "" : "s"}</h2></div>
          <small>Every pallet change saves automatically.</small>
        </div>
        {runs.map((run, index) => {
          const pallets = runTotal(run);
          return <article key={run.key} className={`simple-run-card ${activeKey === run.key ? "active" : ""}`} onClick={() => setActiveKey(run.key)}>
            <div className="simple-run-header">
              <div><strong>Run {index + 1}</strong><small>{run.loadId ? "Live" : "New"}</small></div>
              <div className="run-period-selector"><span>Period</span>{(["AM", "PM"] as const).map((period) => <button key={period} type="button" className={run.period === period ? "selected" : ""} onClick={(event) => {
                event.stopPropagation();
                updateRun(run.key, (current) => ({ ...current, period }));
                void persistPeriod(run, period);
              }}>{period}</button>)}</div>
              <div className={`simple-run-pallets ${pallets > 26 ? "over" : ""}`}><strong>{pallets}</strong><small>/ 26 pallets</small></div>
            </div>
            <div className="simple-run-columns"><span>Collection</span><span>Pallets</span><span>Delivery</span><span /></div>
            <div className="simple-run-lines">
              {run.lines.map((line, lineIndex) => <div className="simple-run-line" key={line.key}>
                <span className="simple-line-number">{lineIndex + 1}</span>
                <input value={line.collectionSite} onChange={(event) => updateLine(run.key, line.key, { collectionSite: event.target.value })} onBlur={() => run.loadId && void syncStops(run.loadId, run.lines, token as never)} placeholder="Collection" />
                <input className="simple-pallet-input" type="number" min="0" inputMode="numeric" value={line.pallets} onChange={(event) => scheduleQuantity(run, line, event.target.value)} placeholder="0" />
                <input value={line.deliverySite} onChange={(event) => updateLine(run.key, line.key, { deliverySite: event.target.value })} placeholder="Delivery" />
                <button type="button" className="simple-clear-line" aria-label={`Clear line ${lineIndex + 1}`} disabled={busyKey === `${run.key}:${line.key}`} onClick={(event) => { event.stopPropagation(); void clearLine(run, line); }}>×</button>
              </div>)}
            </div>
            <div className="simple-run-footer">
              <div className="simple-line-actions"><button type="button" onClick={(event) => { event.stopPropagation(); updateRun(run.key, (current) => ({ ...current, lines: [...current.lines, blankLine()] })); }}>+ Add line</button></div>
              <small>{busyKey === run.key || busyKey?.startsWith(`${run.key}:`) ? "Saving…" : run.loadId ? "✓ Auto-saved" : "Choose an order to start this run"}</small>
            </div>
          </article>;
        })}
        <button className="simple-add-run" type="button" onClick={() => {
          const draft: RunDraft = { key: `shell-${date}-${crypto.randomUUID()}`, period: "", lines: [blankLine()] };
          setRuns((current) => [...current, draft]);
          setActiveKey(draft.key);
        }}>+ Add another run</button>
      </div>

      <aside className="simple-order-pool">
        <div className="simple-order-header"><div><p className="eyebrow">Orders to plan</p><h2>Available now</h2></div><strong>{visible.length}</strong></div>
        <input className="simple-order-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, site or customer…" />
        <p className="simple-order-help">Click an order to add its remaining pallets to the selected run. Split quantities stay here immediately.</p>
        <div className="simple-order-list">
          {visible.map((order) => <button key={order.id} className="simple-order-card" type="button" disabled={Boolean(busyKey)} onClick={() => void addOrder(order)}>
            <span><small>Collection</small><strong>{order.collection}</strong><small>{order.reference}</small></span>
            <span className="simple-order-pallets"><strong>{order.outstandingPallets}</strong><small>of {order.orderedPallets}</small></span>
            <span><small>Delivery</small><strong>{order.destination}</strong><small>{order.customerCode}</small></span>
          </button>)}
          {!visible.length && <p>All current orders are fully planned.</p>}
        </div>
      </aside>
    </div>
  </section>;
}
