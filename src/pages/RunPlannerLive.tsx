import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, request, type Load, type Site } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";
import { RunJobSuggestions } from "../components/RunJobSuggestions";
import "../simple-planner.css";
import { createRun, listRuns, updateRunStops } from '../api/runs';

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
  source?: string;
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
type OrderClusterKey = "markets" | "south-to-north" | "southbound" | "northbound" | "south-local" | "midlands" | "east" | "west-wales" | "other";
type OrderCluster = { key: OrderClusterKey; label: string; note: string; orders: PlanningOrder[]; pallets: number };

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
const plannerSiteName = (sites: Site[], value: string) => {
  const site = siteFor(sites, value);
  if (site) return site.name?.trim() || site.driverTextName?.trim() || value;

  // Keep the planner usable while legacy delivery names are progressively added as
  // Site Master aliases. These two Morrisons source labels are the same physical site.
  const key = normalise(value);
  if (/MORRISONS(?:FRUIT)?STOCKTON\d*/.test(key)) return "Morrisons Stockton";
  return value;
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

const canonicalRegion = (value?: string) => normalise(value);
const SOUTH_REGIONS = new Set(["LONDON", "SOUTHEAST", "SOUTHWEST"]);
const NORTH_REGIONS = new Set(["NORTH"]);

function regionForSite(sites: Site[], value: string) {
  return canonicalRegion(siteFor(sites, value)?.operationalRegion);
}

function matchesMarket(value: string, marketNames: string[]) {
  if (/\bmarket\b/i.test(value)) return true;
  const key = normalise(value);
  return Boolean(key) && marketNames.some((market) => {
    const marketKey = normalise(market);
    return marketKey.length >= 3 && (key === marketKey || key.includes(marketKey) || marketKey.includes(key));
  });
}

function clusterForOrder(order: PlanningOrder, sites: Site[], marketNames: string[]): OrderClusterKey {
  if (matchesMarket(order.collection, marketNames) || matchesMarket(order.destination, marketNames)) return "markets";

  const collectionRegion = regionForSite(sites, order.collection);
  const destinationRegion = regionForSite(sites, order.destination);
  const collectionSouth = SOUTH_REGIONS.has(collectionRegion);
  const destinationSouth = SOUTH_REGIONS.has(destinationRegion);
  const destinationNorth = NORTH_REGIONS.has(destinationRegion);

  if (collectionSouth && destinationNorth) return "south-to-north";
  if (!collectionSouth && destinationSouth) return "southbound";
  if (destinationNorth) return "northbound";
  if (collectionSouth && destinationSouth) return "south-local";
  if (destinationRegion === "MIDLANDS") return "midlands";
  if (destinationRegion === "EAST") return "east";
  if (destinationRegion === "WESTWALES") return "west-wales";
  return "other";
}

function orderTypeLabel(order: PlanningOrder, sites: Site[], marketNames: string[]) {
  const evidence = `${order.source || ""} ${order.collection} ${order.destination}`;
  if (/\bback\s*load\b/i.test(evidence)) return "Backload";
  if (clusterForOrder(order, sites, marketNames) === "markets" || /\bmarket\b/i.test(evidence)) return "Market";
  if (/\btransfer\b/i.test(evidence)) return "Transfer";
  if (/\breturn(?:s)?\b/i.test(evidence)) return "Return";
  if (/\bpre[-\s]?load\b/i.test(evidence)) return "Preload";
  const source = String(order.source || "").trim();
  if (source && source.length <= 24 && !/mail|email|import|parser|workbook|csv/i.test(source)) return source;
  return "Delivery";
}

const CLUSTER_DEFINITIONS: Array<{ key: OrderClusterKey; label: string; note: string }> = [
  { key: "south-to-north", label: "South → North", note: "Northbound work originating in London, South East or South West" },
  { key: "northbound", label: "Northbound", note: "Other work whose destination is in the North" },
  { key: "southbound", label: "Southbound", note: "Work heading into London, South East or South West" },
  { key: "markets", label: "Markets", note: "Market work kept together regardless of direction" },
  { key: "south-local", label: "South / Local", note: "South-origin work remaining within the southern regions" },
  { key: "midlands", label: "Midlands", note: "Work whose destination is in the Midlands" },
  { key: "east", label: "East", note: "Work whose destination is in the East" },
  { key: "west-wales", label: "West / Wales", note: "Work whose destination is in West / Wales" },
  { key: "other", label: "Other / Region not mapped", note: "Orders needing Site Master region or market mapping" },
];

function validPallets(value: string) {
  const pallets = Number(value);
  return Number.isInteger(pallets) && pallets >= 0 ? pallets : undefined;
}

export function RunPlannerLive({ planningDate }: { planningDate?: string } = {}) {
  const token = useAccessToken();
  const dateIsExternallyControlled = Boolean(planningDate);
  const [date, setDate] = useState(planningDate || localDate());
  const [control, setControl] = useState<PlanningControlData>();
  const [loads, setLoads] = useState<Load[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [marketNames, setMarketNames] = useState<string[]>([]);
  const [runs, setRuns] = useState<RunDraft[]>(() => [blankRun(`shell-${localDate()}-1`)]);
  const [activeKey, setActiveKey] = useState(runs[0].key);
  const [busyKey, setBusyKey] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [query, setQuery] = useState("");
  const saveTimers = useRef<Record<string, number>>({});
  const mutationCounter = useRef(0);

  const hydrate = useCallback((nextControl: PlanningControlData, nextLoads: Load[], nextSites: Site[]) => {
    const ordered = [...nextLoads].sort((left, right) => String(left.reference).localeCompare(String(right.reference)));
    if (!ordered.length) {
      const shell = blankRun(`shell-${date}-1`);
      setRuns([shell]);
      setActiveKey(shell.key);
      return;
    }

    const ordersById = new Map(nextControl.orders.map((order) => [order.id, order]));
    const drafts = ordered.map((load) => {
      const seenOrderIds = new Set<string>();
      const sequencedLines = [...load.stops]
        .filter((stop) => Boolean(stop.orderId) && /^deliver/i.test(stop.name))
        .sort((left, right) => left.sequence - right.sequence)
        .flatMap((stop) => {
          const orderId = stop.orderId;
          if (!orderId || seenOrderIds.has(orderId)) return [];
          const order = ordersById.get(orderId);
          const allocation = order?.allocations.find((item) => item.loadId === load.id && item.pallets > 0);
          if (!order || !allocation) return [];
          seenOrderIds.add(order.id);
          return [{
            key: `${load.id}-${order.id}`,
            orderId: order.id,
            collectionSite: plannerSiteName(nextSites, order.collection),
            deliverySite: plannerSiteName(nextSites, order.destination),
            pallets: String(allocation.pallets),
            note: stop.plannerNote || "",
          }];
        });

      // Legacy runs may have allocations but no saved delivery stop. Keep them visible,
      // but only after every line whose explicit stop sequence is already persisted.
      const unsequencedLines = nextControl.orders.flatMap((order) => {
        if (seenOrderIds.has(order.id)) return [];
        const allocation = order.allocations.find((item) => item.loadId === load.id && item.pallets > 0);
        return allocation ? [{
          key: `${load.id}-${order.id}`,
          orderId: order.id,
          collectionSite: plannerSiteName(nextSites, order.collection),
          deliverySite: plannerSiteName(nextSites, order.destination),
          pallets: String(allocation.pallets),
          note: load.stops.find((stop) => stop.orderId === order.id && /^deliver/i.test(stop.name))?.plannerNote || "",
        }] : [];
      });
      const lines = [...sequencedLines, ...unsequencedLines];
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
    const nextControl = await request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, access);
    const [loadsResult, sitesResult, marketsResult] = await Promise.allSettled([
      listRuns(date, access),
      api.sites(access),
      api.marketContacts(access),
    ]);
    const safeLoads = loadsResult.status === "fulfilled" && Array.isArray(loadsResult.value) ? loadsResult.value : [];
    const safeSites = sitesResult.status === "fulfilled" && Array.isArray(sitesResult.value) ? sitesResult.value : [];
    const safeMarkets = marketsResult.status === "fulfilled" && Array.isArray(marketsResult.value) ? marketsResult.value : [];
    setControl(nextControl);
    setLoads(safeLoads);
    setSites(safeSites);
    setMarketNames([...new Set(safeMarkets.map((item) => String(item.market || "").trim()).filter(Boolean))]);
    if (loadsResult.status === "rejected" || sitesResult.status === "rejected" || marketsResult.status === "rejected") {
      setMessage("Planner loaded the approved pallet balance. Some run, site or market master data is temporarily unavailable, so grouping or new run stop details may be limited until refresh.");
    }
    hydrate(nextControl, safeLoads, safeSites);
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
    .filter((order) => !query.trim() || [order.reference, order.customerCode, order.collection, order.destination, order.source]
      .some((value) => String(value || "").toLowerCase().includes(query.toLowerCase())))
    .sort((left, right) => left.collection.localeCompare(right.collection)
      || left.destination.localeCompare(right.destination)
      || left.reference.localeCompare(right.reference)), [effectiveOrders, query]);

  const orderClusters = useMemo<OrderCluster[]>(() => CLUSTER_DEFINITIONS.map((definition) => {
    const clusterOrders = visible
      .filter((order) => clusterForOrder(order, sites, marketNames) === definition.key)
      .sort((left, right) => left.destination.localeCompare(right.destination)
        || left.collection.localeCompare(right.collection)
        || left.reference.localeCompare(right.reference));
    return {
      ...definition,
      orders: clusterOrders,
      pallets: clusterOrders.reduce((total, order) => total + order.outstandingPallets, 0),
    };
  }).filter((cluster) => cluster.orders.length > 0), [marketNames, sites, visible]);

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
      try { await updateRunStops(loadId, [], access); } catch { /* allocation zero remains authoritative */ }
      return;
    }
    await updateRunStops(loadId, stops, access);
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

  async function persistLineNote(run: RunDraft, line: RunLine, note: string) {
    const linesAfterEdit = run.lines.map((item) => item.key === line.key ? { ...item, note } : item);
    updateRun(run.key, (current) => ({ ...current, lines: linesAfterEdit }));
    if (!run.loadId || !line.orderId) return;

    const key = `${run.key}:${line.key}:note`;
    setBusyKey(key);
    try {
      await syncStops(run.loadId, linesAfterEdit, await token());
      signalPlanningChange();
      setMessage("Line note auto-saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Line note could not be saved.");
    } finally {
      setBusyKey((current) => current === key ? undefined : current);
    }
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
      collectionSite: plannerSiteName(sites, order.collection),
      deliverySite: plannerSiteName(sites, order.destination),
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

        const created = await createRun({
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

      // These writes affect separate server resources. Run them together so adding an
      // order does not make the planner wait for two full round trips in sequence.
      await Promise.all([
        allocate(order.id, loadId, order.outstandingPallets, access),
        syncStops(loadId, nextLines, access),
      ]);
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
      {dateIsExternallyControlled
        ? <span><strong>{date}</strong><small> plan date</small></span>
        : <label>Plan date <input type="date" value={date} onChange={(event) => resetForDate(event.target.value)} /></label>}
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
          <small>Click an order on the right. Run quantity changes auto-save.</small>
        </div>

        {runs.map((run, index) => {
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
                <input value={line.note} onChange={(event) => updateLine(run.key, line.key, { note: event.target.value })} onBlur={(event) => void persistLineNote(run, line, event.currentTarget.value)} placeholder="Facility / load-line note" />
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
            {load && activeKey === run.key && <RunJobSuggestions
              lines={run.lines}
              orders={effectiveOrders}
              sites={sites}
              remainingCapacity={Math.max((load.totalPalletSpaces ?? 26) - runTotal(run), 0)}
              busy={Boolean(busyKey)}
              onAdd={(orderId) => {
                const order = effectiveOrders.find((item) => item.id === orderId);
                if (order) void addOrder(order);
              }}
            />}
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
        <p className="simple-order-help">Orders are clustered by planning direction. Each heading shows the remaining order and pallet count; click an order to add its current balance to the selected run.</p>
        <div className="simple-order-list">
          {orderClusters.map((cluster) => <section key={cluster.key} style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end", padding: "8px 2px 4px", borderBottom: "1px solid var(--border, #d0d7de)" }}>
              <div><strong style={{ display: "block" }}>{cluster.label}</strong><small title={cluster.note}>{cluster.orders.length} order{cluster.orders.length === 1 ? "" : "s"}</small></div>
              <div style={{ textAlign: "right" }}><strong style={{ display: "block", fontSize: "1.15rem" }}>{cluster.pallets}</strong><small>pallets remaining</small></div>
            </div>
            {cluster.orders.map((order) => <button key={order.id} className="simple-order-card" type="button" disabled={Boolean(busyKey)} onClick={() => void addOrder(order)}>
              <span><small>{orderTypeLabel(order, sites, marketNames)} · Collection</small><strong>{plannerSiteName(sites, order.collection)}</strong></span>
              <span className="simple-order-pallets"><strong>{order.outstandingPallets}</strong><small>of {order.orderedPallets}</small></span>
              <span><small>Delivery</small><strong>{plannerSiteName(sites, order.destination)}</strong></span>
            </button>)}
          </section>)}
          {!visible.length && <p>All current orders are fully planned.</p>}
        </div>
      </aside>
    </div>
  </section>;
}