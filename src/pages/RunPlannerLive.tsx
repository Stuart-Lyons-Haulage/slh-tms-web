import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, request, type Load, type Site } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";
import { RunPlanningIntelligence } from "../components/RunPlanningIntelligence";
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
  note: string;
};
type RunDraft = { key: string; loadId?: string; period: Period; nightOut: boolean; routeJob: string; operationalAmendment: string; lines: RunLine[] };

const blankLine = (): RunLine => ({ key: crypto.randomUUID(), collectionSite: "", deliverySite: "", pallets: "", note: "" });
const blankRun = (key: string): RunDraft => ({
  key,
  period: "",
  nightOut: false,
  routeJob: "",
  operationalAmendment: "",
  lines: [blankLine()],
});
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const normalise = (value: unknown) => String(value ?? "").trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
const tagged = (notes: string | undefined, label: string) => (notes || "")
  .split("·")
  .map((part) => part.trim())
  .find((part) => part.toLowerCase().startsWith(`${label}:`.toLowerCase()))
  ?.slice(label.length + 1)
  .trim() || "";
const periodFromLoad = (load: Load): Period => {
  const period = tagged(load.plannerNotes, "Planner period").toUpperCase();
  return period === "AM" || period === "PM" ? period : "";
};
const withPlannerPeriod = (notes: string | undefined, period: Period) => {
  const parts = (notes || "").split("·").map((part) => part.trim()).filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith("planner period:"));
  return period ? [`Planner period: ${period}`, ...parts].join(" · ") : parts.join(" · ");
};
const plannerTag = (notes: string | undefined, label: string, value: string) => {
  const parts = (notes || "").split("·").map((part) => part.trim()).filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  return value.trim() ? [`${label}: ${value.trim()}`, ...parts].join(" · ") : parts.join(" · ");
};
const plannerBoolean = (notes: string | undefined, label: string) => tagged(notes, label).toLowerCase() === "yes";
const siteFor = (sites: Site[], value: string) => {
  const target = normalise(value);
  if (!target) return undefined;
  return sites.find((site) =>
    [site.name, site.driverTextName, site.externalCode, ...(site.aliases || "").split(/[,;|]/)]
      .some((candidate) => normalise(candidate) === target));
};
const stopFromSite = (sites: Site[], value: string) => {
  const site = siteFor(sites, value);
  return {
    address: site?.collectionAddress,
    latitude: site?.latitude,
    longitude: site?.longitude,
  };
};
const runRef = (date: string, number: number) => `RUN-${date.replaceAll("-", "")}-${String(number).padStart(2, "0")}`;

function validPallets(value: string) {
  const pallets = Number(value);
  return Number.isInteger(pallets) && pallets >= 0 ? pallets : undefined;
}

export function RunPlannerLive({ planningDate }: { planningDate?: string } = {}) {
  const token = useAccessToken();
  const [date, setDate] = useState(planningDate || localDate());
  const [control, setControl] = useState<PlanningControlData>();
  const [loads, setLoads] = useState<Load[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [runs, setRuns] = useState<RunDraft[]>(() => [blankRun(`shell-${localDate()}-1`)]);
  const [activeKey, setActiveKey] = useState(runs[0].key);
  const [busyKey, setBusyKey] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [query, setQuery] = useState("");
  const saveTimers = useRef<Record<string, number>>({});
  const mutationCounter = useRef(0);

  const hydrate = useCallback((nextControl: PlanningControlData, nextLoads: Load[]) => {
    const ordered = [...nextLoads].sort((left, right) => String(left.reference).localeCompare(String(right.reference)));
    if (!ordered.length) {
      const shell = blankRun(`shell-${date}-1`);
      setRuns([shell]);
      setActiveKey(shell.key);
      return;
    }

    const drafts = ordered.map((load) => {
      const lines = nextControl.orders.flatMap((order) => {
        const allocation = order.allocations.find((item) => item.loadId === load.id && item.pallets > 0);
        return allocation ? [{
          key: `${load.id}-${order.id}`,
          orderId: order.id,
          collectionSite: order.collection,
          deliverySite: order.destination,
          pallets: String(allocation.pallets),
          note: load.stops.find((stop) => stop.orderId === order.id && /^deliver/i.test(stop.name))?.plannerNote || "",
        }] : [];
      });
      return {
        key: load.id,
        loadId: load.id,
        period: periodFromLoad(load),
        nightOut: plannerBoolean(load.plannerNotes, "Night out"),
        routeJob: tagged(load.plannerNotes, "Route/job"),
        operationalAmendment: tagged(load.plannerNotes, "Operational amendment"),
        lines: lines.length ? lines : [blankLine()],
      } satisfies RunDraft;
    });

    setRuns(drafts);
    setActiveKey((current) => drafts.some((run) => run.key === current) ? current : drafts[0].key);
  }, [date]);

  const refreshAll = useCallback(async () => {
    const access = await token();
    const [nextControl, nextLoads, nextSites] = await Promise.all([
      request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, access),
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
    const nextControl = await request<PlanningControlData>(
      `/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`,
      await token(),
    );
    setControl(nextControl);
  }, [date, token]);

  useEffect(() => {
    void refreshAll().catch((error) => setMessage(error instanceof Error ? error.message : "Planner data could not be refreshed."));
    return () => {
      Object.values(saveTimers.current).forEach((id) => window.clearTimeout(id));
      saveTimers.current = {};
    };
  }, [refreshAll]);

  // Reconcile server-side order amendments and changes made from Pallet Control without
  // rebuilding the run draft that the planner is actively editing. Local quantities remain
  // the immediate source of truth; the server is the durable source of truth after autosave.
  useEffect(() => {
    const refresh = () => void refreshControl().catch(() => undefined);
    const interval = window.setInterval(refresh, 20000);
    const unsubscribe = subscribePlanningChanges(refresh);
    return () => {
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [refreshControl]);

  const orders = useMemo(() => control?.orders || [], [control]);

  // Project unsaved keystrokes into the order pool immediately. This is what keeps the
  // residual quantity on the right while the 450ms durable autosave is in flight.
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
      const plannedOutsideThisPlanner = order.allocations
        .filter((allocation) => !localLoadIds.has(allocation.loadId))
        .reduce((sum, allocation) => sum + Math.max(allocation.pallets, 0), 0);
      const locallyPlanned = localByOrder.get(order.id) || 0;
      const plannedPallets = plannedOutsideThisPlanner + locallyPlanned;
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
    .filter((order) => order.outstandingPallets > 0)
    .filter((order) => !query.trim() || [order.reference, order.customerCode, order.collection, order.destination]
      .some((value) => String(value).toLowerCase().includes(query.toLowerCase())))
    .sort((left, right) => left.collection.localeCompare(right.collection)
      || left.destination.localeCompare(right.destination)
      || left.reference.localeCompare(right.reference)), [effectiveOrders, query]);

  const active = runs.find((run) => run.key === activeKey) || runs[0];
  const updateRun = (key: string, updater: (run: RunDraft) => RunDraft) => setRuns((current) =>
    current.map((run) => run.key === key ? updater(run) : run));
  const updateLine = (runKey: string, lineKey: string, patch: Partial<RunLine>) => updateRun(runKey, (run) => ({
    ...run,
    lines: run.lines.map((line) => line.key === lineKey ? { ...line, ...patch } : line),
  }));

  function runTotal(run: RunDraft) {
    return run.lines.reduce((sum, line) => sum + (validPallets(line.pallets) || 0), 0);
  }

  function buildStops(lines: RunLine[]) {
    return lines.filter((line) => {
      const pallets = validPallets(line.pallets);
      return Boolean(line.orderId) && pallets !== undefined && pallets > 0;
    }).flatMap((line) => {
      const collection = stopFromSite(sites, line.collectionSite);
      const delivery = stopFromSite(sites, line.deliverySite);
      return [
        { name: `Collect · ${line.collectionSite}`, ...collection },
        { orderId: line.orderId, name: `Deliver · ${line.deliverySite}`, ...delivery, plannerNote: line.note.trim() || undefined },
      ];
    });
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
    if (!stops.length) {
      // The paired API change allows a Draft run to be completely cleared. Keeping this
      // compatibility catch prevents an older API revision from blocking the allocation reset.
      try { await api.updateLoadStops(loadId, [], access); } catch { /* allocation zero remains authoritative */ }
      return;
    }
    await api.updateLoadStops(loadId, stops, access);
  }

  function notesForRun(run: RunDraft, period = run.period) {
    const current = loads.find((item) => item.id === run.loadId)?.plannerNotes;
    return plannerTag(plannerTag(plannerTag(withPlannerPeriod(current, period), "Night out", run.nightOut ? "Yes" : "No"), "Route/job", run.routeJob), "Operational amendment", run.operationalAmendment);
  }

  async function persistRunDetails(run: RunDraft, patch: Partial<RunDraft>) {
    if (!run.loadId) return;
    const next = { ...run, ...patch };
    const load = loads.find((item) => item.id === run.loadId);
    try {
      await request(`/api/v1/loads/${run.loadId}/utilisation`, await token(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          palletSpacesUsed: runTotal(run),
          totalPalletSpaces: load?.totalPalletSpaces ?? 26,
          capacityType: load?.capacityType ?? "Standard pallets",
          depotSplits: load?.depotSplits,
          temperatureC: load?.temperatureC,
          plannerNotes: notesForRun(next),
        }),
      });
      signalPlanningChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Run details could not be auto-saved.");
    }
  }

  function maxForOrder(orderId: string, runKey: string) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return 0;

    const plannedOnOtherVisibleRuns = runs.filter((run) => run.key !== runKey)
      .flatMap((run) => run.lines)
      .filter((line) => line.orderId === orderId)
      .reduce((sum, line) => sum + (validPallets(line.pallets) || 0), 0);

    const representedLoadIds = new Set(runs.flatMap((run) => run.loadId ? [run.loadId] : []));
    const plannedOnOtherServerRuns = order.allocations
      .filter((allocation) => !representedLoadIds.has(allocation.loadId))
      .reduce((sum, allocation) => sum + Math.max(allocation.pallets, 0), 0);

    return Math.max(order.orderedPallets - plannedOnOtherVisibleRuns - plannedOnOtherServerRuns, 0);
  }

  async function persistQuantity(
    runKey: string,
    lineKey: string,
    orderId: string,
    loadId: string,
    pallets: number,
    linesAfterEdit: RunLine[],
  ) {
    const mutation = ++mutationCounter.current;
    const key = `${runKey}:${lineKey}`;
    setBusyKey(key);
    try {
      const access = await token();
      await allocate(orderId, loadId, pallets, access);
      if (pallets === 0) await syncStops(loadId, linesAfterEdit, access);
      signalPlanningChange();
      setMessage(`Auto-saved · ${pallets} pallet${pallets === 1 ? "" : "s"} on this run.`);
      void refreshControl().catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pallet quantity could not be auto-saved.");
      if (mutation === mutationCounter.current) void refreshAll();
    } finally {
      setBusyKey((current) => current === key ? undefined : current);
    }
  }

  function scheduleQuantity(run: RunDraft, line: RunLine, value: string) {
    const linesAfterEdit = run.lines.map((item) => item.key === line.key ? { ...item, pallets: value } : item);
    updateRun(run.key, (current) => ({ ...current, lines: linesAfterEdit }));

    if (!line.orderId || !run.loadId) return;
    const pallets = validPallets(value);
    if (pallets === undefined) return;

    const maximum = maxForOrder(line.orderId, run.key);
    if (pallets > maximum) {
      setMessage(`Maximum available for this run is ${maximum} pallets. Reduce the quantity to keep the order balance valid.`);
      return;
    }

    const timerKey = `${run.key}:${line.key}`;
    if (saveTimers.current[timerKey]) window.clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = window.setTimeout(() => {
      delete saveTimers.current[timerKey];
      void persistQuantity(run.key, line.key, line.orderId!, run.loadId!, pallets, linesAfterEdit);
    }, 450);
  }

  async function addOrder(order: PlanningOrder) {
    if (!active || order.outstandingPallets <= 0 || busyKey) return;
    if (active.lines.some((line) => line.orderId === order.id)) {
      setMessage(`${order.collection} → ${order.destination} is already on this run. Amend the pallet quantity on the run line.`);
      return;
    }

    const line: RunLine = {
      key: crypto.randomUUID(),
      orderId: order.id,
      collectionSite: order.collection,
      deliverySite: order.destination,
      pallets: String(order.outstandingPallets), note: "",
    };
    const blankIndex = active.lines.findIndex((item) => !item.orderId && !item.collectionSite && !item.deliverySite && !item.pallets);
    const nextLines = blankIndex >= 0
      ? active.lines.map((item, index) => index === blankIndex ? line : item)
      : [...active.lines, line];

    updateRun(active.key, (run) => ({ ...run, lines: nextLines }));
    setBusyKey(active.key);

    try {
      const access = await token();
      let loadId = active.loadId;
      if (!loadId) {
        const index = Math.max(runs.findIndex((run) => run.key === active.key), 0);
        const existingReferences = new Set(loads.map((load) => load.reference.toUpperCase()));
        let number = index + 1;
        while (existingReferences.has(runRef(date, number).toUpperCase())) number += 1;

        const created = await api.createLoad({
          reference: runRef(date, number),
          planningDate: date,
          palletSpacesUsed: order.outstandingPallets,
          totalPalletSpaces: 26,
          capacityType: "Standard pallets",
          plannerNotes: notesForRun(active),
          stops: buildStops(nextLines),
        }, access);
        loadId = created.id;
        setLoads((current) => current.some((load) => load.id === created.id) ? current : [...current, created]);
        updateRun(active.key, (run) => ({ ...run, loadId }));
      }

      await allocate(order.id, loadId, order.outstandingPallets, access);
      await syncStops(loadId, nextLines, access);
      signalPlanningChange();
      setMessage(`${order.outstandingPallets} pallet${order.outstandingPallets === 1 ? "" : "s"} added and auto-saved. Any remaining balance stays in Orders to Plan.`);
      void refreshControl().catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order could not be added to the run.");
      await refreshAll().catch(() => undefined);
    } finally {
      setBusyKey(undefined);
    }
  }

  async function clearLine(run: RunDraft, line: RunLine) {
    const timerKey = `${run.key}:${line.key}`;
    if (saveTimers.current[timerKey]) {
      window.clearTimeout(saveTimers.current[timerKey]);
      delete saveTimers.current[timerKey];
    }

    const remaining = run.lines.length === 1 ? [blankLine()] : run.lines.filter((item) => item.key !== line.key);
    updateRun(run.key, (current) => ({ ...current, lines: remaining }));
    if (!line.orderId || !run.loadId) return;

    setBusyKey(timerKey);
    try {
      const access = await token();
      await allocate(line.orderId, run.loadId, 0, access);
      await syncStops(run.loadId, remaining, access);
      signalPlanningChange();
      setMessage("Order removed from the run and its pallets returned to Orders to Plan.");
      void refreshControl().catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order could not be removed from the run.");
      await refreshAll().catch(() => undefined);
    } finally {
      setBusyKey(undefined);
    }
  }

  function resetForDate(nextDate: string) {
    Object.values(saveTimers.current).forEach((id) => window.clearTimeout(id));
    saveTimers.current = {};
    setDate(nextDate);
    setMessage(undefined);
    const shell = blankRun(`shell-${nextDate}-1`);
    setRuns([shell]);
    setActiveKey(shell.key);
  }

  useEffect(() => {
    if (planningDate && planningDate !== date) resetForDate(planningDate);
  }, [date, planningDate]);

  return <section className="simple-planner">
    <div className="simple-planner-toolbar">
      <label>Plan date <input type="date" value={date} onChange={(event) => resetForDate(event.target.value)} /></label>
      <button onClick={() => void refreshAll()} disabled={Boolean(busyKey)}>Refresh</button>
      <button className="primary" onClick={() => {
        const draft = blankRun(`shell-${date}-${crypto.randomUUID()}`);
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
          <small>Click an order on the right. Pallet changes auto-save.</small>
        </div>

        {runs.map((run, index) => {
          const pallets = runTotal(run);
          const saving = busyKey === run.key || busyKey?.startsWith(`${run.key}:`);
          const load = loads.find((item) => item.id === run.loadId);
          return <article key={run.key} className={`simple-run-card ${activeKey === run.key ? "active" : ""}`} onClick={() => setActiveKey(run.key)}>
            <div className="simple-run-header">
              <div><strong>Run {index + 1}</strong><small>{run.loadId ? "Live" : "New"}</small></div>
              <div className="run-period-selector">
                <span>Period</span>
                {(["AM", "PM"] as const).map((period) => <button key={period} type="button" className={run.period === period ? "selected" : ""} onClick={(event) => {
                  event.stopPropagation();
                  updateRun(run.key, (current) => ({ ...current, period }));
                  void persistRunDetails(run, { period });
                }}>{period}</button>)}
              </div>
              <div className={`simple-run-pallets ${pallets > 26 ? "over" : ""}`}><strong>{pallets}</strong><small>/ 26 pallets</small></div>
            </div>

            <div className="simple-run-details">
              <label>Route / job<input value={run.routeJob} placeholder="Route or job selection" onChange={(event) => updateRun(run.key, (current) => ({ ...current, routeJob: event.target.value }))} onBlur={() => void persistRunDetails(run, { routeJob: run.routeJob })} /></label>
              <label className="simple-night-out"><input type="checkbox" checked={run.nightOut} onChange={(event) => { const nightOut = event.target.checked; updateRun(run.key, (current) => ({ ...current, nightOut })); void persistRunDetails(run, { nightOut }); }} /> Night out confirmed</label>
              <label>Operational amendment<input value={run.operationalAmendment} placeholder="e.g. swap to trailer 123 / breakdown" onChange={(event) => updateRun(run.key, (current) => ({ ...current, operationalAmendment: event.target.value }))} onBlur={() => void persistRunDetails(run, { operationalAmendment: run.operationalAmendment })} /></label>
            </div>
            <div className="simple-run-columns"><span>Collection</span><span>Pallets</span><span>Delivery</span><span>Line note</span><span /></div>
            <div className="simple-run-lines">
              {run.lines.map((line, lineIndex) => <div className="simple-run-line" key={line.key}>
                <span className="simple-line-number">{lineIndex + 1}</span>
                <input value={line.collectionSite} readOnly={Boolean(line.orderId)} onChange={(event) => updateLine(run.key, line.key, { collectionSite: event.target.value })} placeholder="Collection" />
                <input className="simple-pallet-input" type="number" min="0" inputMode="numeric" value={line.pallets} onChange={(event) => scheduleQuantity(run, line, event.target.value)} placeholder="0" />
                <input value={line.deliverySite} readOnly={Boolean(line.orderId)} onChange={(event) => updateLine(run.key, line.key, { deliverySite: event.target.value })} placeholder="Delivery" />
                <input value={line.note} onChange={(event) => updateLine(run.key, line.key, { note: event.target.value })} onBlur={() => { if (run.loadId) void (async () => { try { await syncStops(run.loadId!, run.lines, await token()); setMessage("Line note auto-saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "Line note could not be saved."); } })(); }} placeholder="Facility / load-line note" />
                <button type="button" className="simple-clear-line" aria-label={`Clear line ${lineIndex + 1}`} disabled={busyKey === `${run.key}:${line.key}`} onClick={(event) => {
                  event.stopPropagation();
                  void clearLine(run, line);
                }}>×</button>
              </div>)}
            </div>

            <div className="simple-run-footer">
              <div className="simple-line-actions"><button type="button" onClick={(event) => {
                event.stopPropagation();
                updateRun(run.key, (current) => ({ ...current, lines: [...current.lines, blankLine()] }));
              }}>+ Add line</button></div>
              <small>{saving ? "Saving…" : run.loadId ? "✓ Auto-saved" : "Choose an order to start this run"}</small>
            </div>
            {load && activeKey === run.key && <RunPlanningIntelligence load={load} onChanged={refreshAll} />}
          </article>;
        })}

        <button className="simple-add-run" type="button" onClick={() => {
          const draft = blankRun(`shell-${date}-${crypto.randomUUID()}`);
          setRuns((current) => [...current, draft]);
          setActiveKey(draft.key);
        }}>+ Add another run</button>
      </div>

      <aside className="simple-order-pool">
        <div className="simple-order-header">
          <div><p className="eyebrow">Orders to plan</p><h2>Available now</h2></div>
          <strong>{visible.length}</strong>
        </div>
        <input className="simple-order-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, site or customer…" />
        <p className="simple-order-help">Click to add the current balance to the selected run. If you reduce the pallets on the run, the remainder appears here immediately.</p>
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
