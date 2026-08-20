import { useCallback, useEffect, useMemo, useState } from "react";
import { api, request, type Load, type Site } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";
import { useApi } from "../lib/useApi";
import "../simple-planner.css";

type Period = "" | "AM" | "PM";
type Allocation = { loadId: string; loadReference?: string; pallets: number; updatedAtUtc: string; updatedBy?: string };
type PlanningOrder = {
  id: string;
  reference: string;
  customerCode: string;
  orderedPallets: number;
  plannedPallets: number;
  outstandingPallets: number;
  overplannedPallets: number;
  collection: string;
  destination: string;
  allocations: Allocation[];
};
type PlanningControlData = {
  date: string;
  generatedAtUtc: string;
  summary: { ordered: number; planned: number; outstanding: number; overplanned: number; orders: number; runs: number };
  orders: PlanningOrder[];
};
type RunLine = {
  key: string;
  orderId?: string;
  collectionSite: string;
  deliverySite: string;
  pallets: string;
  persistedPallets: number;
};
type RunDraft = {
  key: string;
  loadId?: string;
  period: Period;
  lines: RunLine[];
};

type AllocationResult = {
  outstandingPallets: number;
  overplannedPallets: number;
  loadReference: string;
};

const DEFAULT_LINES = 6;

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalise(value: unknown) {
  return text(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function tagged(notes: string | undefined, label: string) {
  if (!notes) return "";
  const prefix = `${label}:`;
  return notes
    .split("·")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(prefix.toLowerCase()))
    ?.slice(prefix.length)
    .trim() || "";
}

function periodFromLoad(load: Load): Period {
  const value = tagged(load.plannerNotes, "Planner period").toUpperCase();
  return value === "AM" || value === "PM" ? value : "";
}

function withPlannerPeriod(notes: string | undefined, period: Exclude<Period, "">) {
  const parts = (notes || "")
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith("planner period:"));
  return [`Planner period: ${period}`, ...parts].join(" · ");
}

function blankLine(): RunLine {
  return {
    key: crypto.randomUUID(),
    collectionSite: "",
    deliverySite: "",
    pallets: "",
    persistedPallets: 0,
  };
}

function padLines(lines: RunLine[]) {
  const next = [...lines];
  while (next.length < DEFAULT_LINES) next.push(blankLine());
  return next;
}

function runReference(date: string, number: number) {
  return `RUN-${date.replaceAll("-", "")}-${String(number).padStart(2, "0")}`;
}

function siteMatches(site: Site, value: string) {
  const target = normalise(value);
  return [site.name, site.driverTextName, site.externalCode, ...(site.aliases || "").split(/[,;|]/)]
    .some((candidate) => normalise(candidate) === target);
}

function stopSiteDetails(sites: Site[], value: string) {
  const site = sites.find((item) => siteMatches(item, value));
  return {
    address: site?.collectionAddress,
    latitude: site?.latitude,
    longitude: site?.longitude,
  };
}

function buildStops(lines: Array<RunLine & { orderId: string }>, sites: Site[]) {
  return lines.flatMap((line) => {
    const collection = stopSiteDetails(sites, line.collectionSite);
    const delivery = stopSiteDetails(sites, line.deliverySite);
    return [
      {
        name: `Collect · ${line.collectionSite}`,
        ...collection,
      },
      {
        orderId: line.orderId,
        name: `Deliver · ${line.deliverySite}`,
        ...delivery,
      },
    ];
  });
}

export function StablePlanner() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const [query, setQuery] = useState("");
  const [runs, setRuns] = useState<RunDraft[]>([]);
  const [activeRunKey, setActiveRunKey] = useState<string>();
  const [busyRunKey, setBusyRunKey] = useState<string>();
  const [message, setMessage] = useState<string>();

  const loadsApi = useApi(useCallback(async () => api.loads(date, await token()), [date, token]));
  const sitesApi = useApi(useCallback(async () => api.sites(await token()), [token]));
  const controlApi = useApi(useCallback(async () => request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, await token()), [date, token]));

  const loads = useMemo(() => Array.isArray(loadsApi.data) ? loadsApi.data.filter(Boolean) : [], [loadsApi.data]);
  const sites = useMemo(() => Array.isArray(sitesApi.data) ? sitesApi.data.filter((site) => site?.active !== false) : [], [sitesApi.data]);
  const planningOrders = useMemo(() => controlApi.data?.orders || [], [controlApi.data]);

  useEffect(() => {
    if (loadsApi.loading || controlApi.loading) return;

    const orderedLoads = [...loads].sort((a, b) => text(a.reference).localeCompare(text(b.reference)));
    if (orderedLoads.length === 0) {
      const shell: RunDraft = { key: `shell-${date}-1`, period: "", lines: padLines([]) };
      setRuns([shell]);
      setActiveRunKey(shell.key);
      return;
    }

    const drafts = orderedLoads.map((load) => {
      const allocated = planningOrders
        .map((order) => {
          const allocation = order.allocations.find((item) => item.loadId === load.id && item.pallets > 0);
          return allocation ? { order, allocation } : undefined;
        })
        .filter(Boolean) as Array<{ order: PlanningOrder; allocation: Allocation }>;

      const lines = allocated.map(({ order, allocation }) => ({
        key: `${load.id}-${order.id}`,
        orderId: order.id,
        collectionSite: order.collection,
        deliverySite: order.destination,
        pallets: String(allocation.pallets),
        persistedPallets: allocation.pallets,
      }));

      return {
        key: load.id,
        loadId: load.id,
        period: periodFromLoad(load),
        lines: padLines(lines),
      } satisfies RunDraft;
    });

    setRuns(drafts);
    setActiveRunKey((current) => current && drafts.some((run) => run.key === current) ? current : drafts[0]?.key);
  }, [controlApi.loading, date, loads, loadsApi.loading, planningOrders]);

  const siteOptions = useMemo(() => {
    const values = new Set<string>();
    for (const site of sites) {
      if (site.name) values.add(site.name);
      if (site.driverTextName) values.add(site.driverTextName);
    }
    for (const order of planningOrders) {
      if (order.collection) values.add(order.collection);
      if (order.destination) values.add(order.destination);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [planningOrders, sites]);

  const visibleOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return planningOrders
      .filter((order) => order.outstandingPallets > 0)
      .filter((order) => !q || [order.reference, order.customerCode, order.collection, order.destination]
        .some((value) => text(value).toLowerCase().includes(q)))
      .sort((a, b) => a.collection.localeCompare(b.collection) || a.destination.localeCompare(b.destination) || a.reference.localeCompare(b.reference));
  }, [planningOrders, query]);

  const activeRun = runs.find((run) => run.key === activeRunKey) || runs[0];

  function updateRun(runKey: string, updater: (run: RunDraft) => RunDraft) {
    setRuns((current) => current.map((run) => run.key === runKey ? updater(run) : run));
  }

  function updateLine(runKey: string, lineKey: string, patch: Partial<RunLine>) {
    updateRun(runKey, (run) => ({
      ...run,
      lines: run.lines.map((line) => line.key === lineKey ? { ...line, ...patch } : line),
    }));
  }

  function addLine(runKey: string) {
    updateRun(runKey, (run) => ({ ...run, lines: [...run.lines, blankLine()] }));
  }

  function removeLine(runKey: string) {
    updateRun(runKey, (run) => run.lines.length <= DEFAULT_LINES ? run : { ...run, lines: run.lines.slice(0, -1) });
  }

  function clearLine(runKey: string, lineKey: string) {
    updateLine(runKey, lineKey, { orderId: undefined, collectionSite: "", deliverySite: "", pallets: "", persistedPallets: 0 });
  }

  function addRun() {
    const next = runs.length + 1;
    const draft: RunDraft = { key: `shell-${date}-${crypto.randomUUID()}`, period: "", lines: padLines([]) };
    setRuns((current) => [...current, draft]);
    setActiveRunKey(draft.key);
    setMessage(`Run ${next} is ready.`);
  }

  function addOrderToRun(order: PlanningOrder) {
    if (!activeRun) return;
    if (activeRun.lines.some((line) => line.orderId === order.id)) {
      setMessage(`${order.collection} → ${order.destination} is already on this run. Edit the pallet amount in the run line.`);
      return;
    }

    updateRun(activeRun.key, (run) => {
      const firstBlank = run.lines.findIndex((line) => !line.orderId && !line.collectionSite && !line.deliverySite && !line.pallets);
      const value: RunLine = {
        key: crypto.randomUUID(),
        orderId: order.id,
        collectionSite: order.collection,
        deliverySite: order.destination,
        pallets: String(order.outstandingPallets),
        persistedPallets: 0,
      };
      if (firstBlank >= 0) {
        const lines = [...run.lines];
        lines[firstBlank] = value;
        return { ...run, lines };
      }
      return { ...run, lines: [...run.lines, value] };
    });
    setMessage(`Added ${order.collection} → ${order.destination} to the selected run. Adjust pallets if you are splitting the order.`);
  }

  function resolveOrder(line: RunLine, loadId?: string) {
    if (line.orderId) return planningOrders.find((order) => order.id === line.orderId);
    const candidates = planningOrders.filter((order) =>
      (order.outstandingPallets > 0 || order.allocations.some((allocation) => allocation.loadId === loadId)) &&
      normalise(order.collection) === normalise(line.collectionSite) &&
      normalise(order.destination) === normalise(line.deliverySite));
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  async function allocate(orderId: string, loadId: string, pallets: number, accessToken: string) {
    return request<AllocationResult>("/api/v1/planning-control/allocations", accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, loadId, date, pallets, note: "Updated from simplified Run Builder" }),
    });
  }

  async function saveRun(run: RunDraft, runNumber: number) {
    if (busyRunKey) return;
    setMessage(undefined);

    if (!run.period) {
      setMessage(`Select AM or PM for Run ${runNumber}.`);
      return;
    }

    const usedLines = run.lines.filter((line) => line.orderId || line.collectionSite || line.deliverySite || line.pallets);
    if (usedLines.length === 0) {
      setMessage(`Run ${runNumber} is an empty shell. Add at least one order before saving.`);
      return;
    }

    const resolved: Array<RunLine & { orderId: string }> = [];
    const seen = new Set<string>();
    for (const line of usedLines) {
      if (!line.collectionSite || !line.deliverySite) {
        setMessage(`Run ${runNumber}: every used line needs both a collection and delivery site.`);
        return;
      }
      const pallets = Number(line.pallets);
      if (!Number.isInteger(pallets) || pallets <= 0) {
        setMessage(`Run ${runNumber}: enter a whole pallet amount greater than zero on every used line.`);
        return;
      }
      const order = resolveOrder(line, run.loadId);
      if (!order) {
        setMessage(`Run ${runNumber}: ${line.collectionSite} → ${line.deliverySite} does not resolve to one outstanding order. Tap the correct order on the right first.`);
        return;
      }
      if (seen.has(order.id)) {
        setMessage(`Run ${runNumber}: the same order is on more than one line. Keep one line and enter the total pallets for this run.`);
        return;
      }
      seen.add(order.id);
      const existingHere = order.allocations.find((allocation) => allocation.loadId === run.loadId)?.pallets || 0;
      const plannedElsewhere = Math.max(order.plannedPallets - existingHere, 0);
      const availableForThisRun = Math.max(order.orderedPallets - plannedElsewhere, 0);
      if (pallets > availableForThisRun) {
        setMessage(`${order.collection} → ${order.destination}: maximum available for this run is ${availableForThisRun} pallets.`);
        return;
      }
      resolved.push({ ...line, orderId: order.id, pallets: String(pallets) });
    }

    setBusyRunKey(run.key);
    try {
      const accessToken = await token();
      const totalPallets = resolved.reduce((sum, line) => sum + Number(line.pallets), 0);
      const stops = buildStops(resolved, sites);
      let loadId = run.loadId;
      let load = loadId ? loads.find((item) => item.id === loadId) : undefined;

      if (!loadId) {
        const reference = runReference(date, runNumber);
        const created = await api.createLoad({
          reference,
          planningDate: date,
          palletSpacesUsed: totalPallets,
          totalPalletSpaces: 26,
          capacityType: "Standard pallets",
          plannerNotes: `Planner period: ${run.period}`,
          stops,
        }, accessToken);
        loadId = created.id;
        load = created;
      } else {
        await api.updateLoadStops(loadId, stops, accessToken);
      }

      const existingOrderIds = planningOrders
        .filter((order) => order.allocations.some((allocation) => allocation.loadId === loadId && allocation.pallets > 0))
        .map((order) => order.id);
      const nextOrderIds = new Set(resolved.map((line) => line.orderId));

      for (const orderId of existingOrderIds.filter((orderId) => !nextOrderIds.has(orderId))) {
        await allocate(orderId, loadId, 0, accessToken);
      }
      for (const line of resolved) {
        await allocate(line.orderId, loadId, Number(line.pallets), accessToken);
      }

      // The allocation endpoint preserves legacy stop linkage even for a zero quantity.
      // Re-apply the planner's final stop set so moving/removing a split cannot leave a stale stop behind.
      await api.updateLoadStops(loadId, stops, accessToken);

      await api.updateLoadUtilisation(loadId, {
        palletSpacesUsed: totalPallets,
        totalPalletSpaces: load?.totalPalletSpaces ?? 26,
        capacityType: load?.capacityType || "Standard pallets",
        depotSplits: load?.depotSplits,
        temperatureC: load?.temperatureC,
        plannerNotes: withPlannerPeriod(load?.plannerNotes, run.period),
      }, accessToken);

      await Promise.all([loadsApi.refresh(), controlApi.refresh()]);
      signalPlanningChange();
      setMessage(`Run ${runNumber} saved · ${run.period} · ${totalPallets} pallets. Split balances remain in Orders until fully planned.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Run ${runNumber} could not be saved.`);
    } finally {
      setBusyRunKey(undefined);
    }
  }

  const loading = loadsApi.loading || controlApi.loading || sitesApi.loading;
  const error = loadsApi.error || controlApi.error || sitesApi.error;

  useEffect(() => subscribePlanningChanges(() => {
    void loadsApi.refresh();
    void controlApi.refresh();
  }), [controlApi.refresh, loadsApi.refresh]);

  return <section className="simple-planner">
    <datalist id="planner-site-options">
      {siteOptions.map((option) => <option key={option} value={option} />)}
    </datalist>

    <div className="simple-planner-toolbar">
      <label>Planning date <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setRuns([]); setMessage(undefined); }} /></label>
      <div className="simple-planner-summary">
        <span><strong>{controlApi.data?.summary.outstanding ?? 0}</strong> pallets outstanding</span>
        <span><strong>{runs.length || 1}</strong> run{(runs.length || 1) === 1 ? "" : "s"}</span>
      </div>
      <button type="button" onClick={() => { void loadsApi.refresh(); void controlApi.refresh(); void sitesApi.refresh(); }} disabled={loading}>Refresh</button>
    </div>

    {message && <p className="notice inline-notice simple-planner-notice">{message}</p>}
    {error && <p className="notice inline-notice simple-planner-notice">{error}</p>}

    <div className="simple-planner-layout">
      <div className="simple-run-builder">
        <div className="simple-section-heading">
          <div><p className="eyebrow">Run builder</p><h2>Build the day</h2></div>
          <small>Tap an order on the right to place it into the selected run.</small>
        </div>

        {runs.map((run, runIndex) => {
          const runNumber = runIndex + 1;
          const totalPallets = run.lines.reduce((sum, line) => sum + (Number(line.pallets) || 0), 0);
          const active = run.key === activeRun?.key;
          return <article key={run.key} className={`simple-run-card ${active ? "active" : ""}`} onClick={() => setActiveRunKey(run.key)}>
            <div className="simple-run-header">
              <div><strong>Run {runNumber}</strong>{run.loadId && <small>Saved</small>}</div>
              <div className="run-period-selector" onClick={(event) => event.stopPropagation()}>
                <span>Run</span>
                {(["AM", "PM"] as const).map((period) => <button key={period} type="button" className={run.period === period ? "selected" : ""} onClick={() => updateRun(run.key, (current) => ({ ...current, period }))}>{period}</button>)}
              </div>
              <div className={`simple-run-pallets ${totalPallets > 26 ? "over" : ""}`}><strong>{totalPallets}</strong><small>/ 26 pallets</small></div>
            </div>

            <div className="simple-run-columns" aria-hidden="true"><span>Collection site</span><span>Pallets</span><span>Delivery site</span><span /></div>
            <div className="simple-run-lines" onClick={(event) => event.stopPropagation()}>
              {run.lines.map((line, lineIndex) => <div className="simple-run-line" key={line.key}>
                <span className="simple-line-number">{lineIndex + 1}</span>
                <input aria-label={`Run ${runNumber} line ${lineIndex + 1} collection site`} list="planner-site-options" placeholder="Collection site" value={line.collectionSite} onChange={(event) => updateLine(run.key, line.key, { collectionSite: event.target.value, orderId: line.orderId && normalise(event.target.value) === normalise(line.collectionSite) ? line.orderId : undefined })} />
                <input aria-label={`Run ${runNumber} line ${lineIndex + 1} pallets`} className="simple-pallet-input" type="number" min="1" step="1" placeholder="0" value={line.pallets} onChange={(event) => updateLine(run.key, line.key, { pallets: event.target.value })} />
                <input aria-label={`Run ${runNumber} line ${lineIndex + 1} delivery site`} list="planner-site-options" placeholder="Delivery site" value={line.deliverySite} onChange={(event) => updateLine(run.key, line.key, { deliverySite: event.target.value, orderId: line.orderId && normalise(event.target.value) === normalise(line.deliverySite) ? line.orderId : undefined })} />
                <button type="button" className="simple-clear-line" title="Clear line" aria-label={`Clear Run ${runNumber} line ${lineIndex + 1}`} onClick={() => clearLine(run.key, line.key)}>−</button>
              </div>)}
            </div>

            <div className="simple-run-footer" onClick={(event) => event.stopPropagation()}>
              <div className="simple-line-actions">
                <button type="button" onClick={() => addLine(run.key)}>+ Line</button>
                <button type="button" disabled={run.lines.length <= DEFAULT_LINES} onClick={() => removeLine(run.key)}>− Line</button>
              </div>
              <button type="button" className="primary" disabled={busyRunKey === run.key} onClick={() => void saveRun(run, runNumber)}>{busyRunKey === run.key ? "Saving…" : `Save Run ${runNumber}`}</button>
            </div>
          </article>;
        })}

        <button type="button" className="simple-add-run" onClick={addRun}>＋ Add another Run</button>
      </div>

      <aside className="simple-order-pool">
        <div className="simple-order-header">
          <div><p className="eyebrow">Orders</p><h2>Still to plan</h2></div>
          <strong>{visibleOrders.length}</strong>
        </div>
        <input className="simple-order-search" placeholder="Search site or order…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <p className="simple-order-help">Planning view only. Full order detail remains in Order Control and Pallet Control.</p>
        <div className="simple-order-list">
          {!loading && visibleOrders.length === 0 && <div className="state">No outstanding pallet orders for this date.</div>}
          {visibleOrders.map((order) => <button key={order.id} type="button" className="simple-order-card" onClick={() => addOrderToRun(order)}>
            <span><small>Collection</small><strong>{order.collection}</strong></span>
            <span className="simple-order-pallets"><strong>{order.outstandingPallets}</strong><small>pallet{order.outstandingPallets === 1 ? "" : "s"}</small></span>
            <span><small>Delivery</small><strong>{order.destination}</strong></span>
          </button>)}
        </div>
      </aside>
    </div>
  </section>;
}
