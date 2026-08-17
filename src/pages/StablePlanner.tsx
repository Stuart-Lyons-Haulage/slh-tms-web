import { useCallback, useMemo, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api, type Load, type LoadStop, type TransportOrder } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import "../operational-planner.css";

type Period = "AM" | "PM" | "TBC";
type Job = {
  order: TransportOrder;
  customer: string;
  collectionSite: string;
  depotId: string;
  destination: string;
  address: string;
  customerRef: string;
  poRef: string;
  orderType: string;
  planningTime: string;
  period: Period;
};

const PERIOD_ORDER: Record<Period, number> = { AM: 0, PM: 1, TBC: 2 };

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter(Boolean) as T[] : [];
}

function text(value: unknown) {
  return String(value ?? "").trim();
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

function canonicalTime(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const twelve = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (twelve) {
    let hour = Number(twelve[1]) % 12;
    if (twelve[3].toLowerCase() === "pm") hour += 12;
    return `${String(hour).padStart(2, "0")}:${twelve[2] || "00"}`;
  }
  const twentyFour = raw.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (twentyFour) return `${String(Number(twentyFour[1])).padStart(2, "0")}:${twentyFour[2]}`;
  return "";
}

function planningTime(order: TransportOrder) {
  const notes = order.driverInstructions;
  const taggedTime = [
    tagged(notes, "Collection time"),
    tagged(notes, "Requested time"),
    tagged(notes, "Delivery time"),
    tagged(notes, "Planning time"),
  ].map(canonicalTime).find(Boolean);
  if (taggedTime) return taggedTime;
  const window = text(order.deliveryWindowStartUtc);
  if (!window) return "";
  const parsed = new Date(window);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function periodFromTime(time: string): Period {
  if (!time) return "TBC";
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return "TBC";
  return hour < 12 ? "AM" : "PM";
}

function asJob(order: TransportOrder): Job {
  const time = planningTime(order);
  const explicitType = tagged(order.driverInstructions, "Order type");
  const orderType = explicitType || (/\bcrate(s)?\b/i.test(`${order.driverInstructions || ""} ${order.stallNumber || ""}`) ? "Crates" : "Pallets");
  return {
    order,
    customer: text(order.customerCode) || "Customer not identified",
    collectionSite: text(order.sellerName) || tagged(order.driverInstructions, "Collection site") || "Collection not mapped",
    depotId: text(order.marketName) || tagged(order.driverInstructions, "Depot ID"),
    destination: text(order.stallNumber) || tagged(order.driverInstructions, "Depot") || "Destination not mapped",
    address: tagged(order.driverInstructions, "Delivery address"),
    customerRef: tagged(order.driverInstructions, "Customer ref"),
    poRef: tagged(order.driverInstructions, "PO ref"),
    orderType,
    planningTime: time,
    period: periodFromTime(time),
  };
}

function safeStops(load: Load): LoadStop[] {
  return safeArray<LoadStop>(load?.stops).filter((stop) => stop && typeof stop === "object");
}

function runPeriod(load: Load): Period {
  const period = tagged(load.plannerNotes, "Planner period").toUpperCase();
  if (period === "AM" || period === "PM") return period;
  return "TBC";
}

export function StablePlanner() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const [query, setQuery] = useState("");
  const [selectedLoadId, setSelectedLoadId] = useState<string>();
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const ordersApi = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token]));
  const loadsApi = useApi(useCallback(async () => api.loads(date, await token()), [date, token]));

  const loads = useMemo(
    () => safeArray<Load>(loadsApi.data).map((load) => ({ ...load, stops: safeStops(load) })),
    [loadsApi.data],
  );

  const sortedLoads = useMemo(() => [...loads].sort((a, b) =>
    PERIOD_ORDER[runPeriod(a)] - PERIOD_ORDER[runPeriod(b)] || text(a.reference).localeCompare(text(b.reference))), [loads]);

  const runNumberById = useMemo(
    () => new Map(sortedLoads.map((load, index) => [load.id, index + 1])),
    [sortedLoads],
  );

  const plannedOrderIds = useMemo(
    () => new Set(loads.flatMap((load) => safeStops(load).flatMap((stop) => stop.orderId ? [stop.orderId] : []))),
    [loads],
  );

  const jobs = useMemo(
    () => safeArray<TransportOrder>(ordersApi.data)
      .filter((order) => order && order.id && !plannedOrderIds.has(order.id))
      .filter((order) => !["Cancelled", "Delivered"].includes(text(order.status)))
      .map(asJob),
    [ordersApi.data, plannedOrderIds],
  );

  const visibleJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = q ? jobs.filter((item) => [
      item.order.reference,
      item.customer,
      item.collectionSite,
      item.depotId,
      item.destination,
      item.address,
      item.customerRef,
      item.poRef,
      item.orderType,
      item.planningTime,
    ].some((value) => text(value).toLowerCase().includes(q))) : jobs;
    return [...source].sort((a, b) =>
      PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period] ||
      a.planningTime.localeCompare(b.planningTime) ||
      a.collectionSite.localeCompare(b.collectionSite) ||
      a.destination.localeCompare(b.destination));
  }, [jobs, query]);

  const selectedLoad = loads.find((load) => load.id === selectedLoadId);
  const selectedJob = jobs.find((job) => job.order.id === selectedJobId);
  const amJobs = visibleJobs.filter((job) => job.period === "AM");
  const pmJobs = visibleJobs.filter((job) => job.period === "PM");
  const tbcJobs = visibleJobs.filter((job) => job.period === "TBC");

  async function createRun(orderId: string) {
    const item = jobs.find((candidate) => candidate.order.id === orderId);
    if (!item || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const nextRunNumber = loads.length + 1;
      const stops: Array<{ orderId?: string; name: string; address?: string }> = [];
      if (item.collectionSite && item.collectionSite !== "Collection not mapped") {
        stops.push({ name: `Collect · ${item.collectionSite}` });
      }
      stops.push({
        orderId: item.order.id,
        name: `Deliver · ${item.customer} · ${item.destination || item.depotId || item.order.reference}`,
        address: item.address || undefined,
      });
      const created = await api.createLoad({
        reference: `RUN-${date.replaceAll("-", "")}-${String(nextRunNumber).padStart(2, "0")}`,
        planningDate: date,
        palletSpacesUsed: item.orderType.toLowerCase().includes("crate") ? 0 : Number(item.order.pallets) || 0,
        totalPalletSpaces: 26,
        capacityType: "Standard pallets",
        plannerNotes: [
          `Planner period: ${item.period}`,
          item.planningTime ? `Planning time: ${item.planningTime}` : "",
          `Order type: ${item.orderType}`,
        ].filter(Boolean).join(" · "),
        stops,
      }, await token());
      setSelectedLoadId(created.id);
      setSelectedJobId(undefined);
      await Promise.all([ordersApi.refresh(), loadsApi.refresh()]);
      setMessage(`Run ${nextRunNumber} created for ${item.period}: ${item.collectionSite} → ${item.destination}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The run could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function addToRun(load: Load, orderId: string) {
    const item = jobs.find((candidate) => candidate.order.id === orderId);
    if (!item || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const current = safeStops(load).map((stop) => ({
        orderId: stop.orderId,
        name: text(stop.name) || "Stop",
        address: text(stop.address) || undefined,
        latitude: stop.latitude,
        longitude: stop.longitude,
        plannedArrivalUtc: stop.plannedArrivalUtc,
      }));
      if (item.collectionSite !== "Collection not mapped" && !current.some((stop) => text(stop.name).toLowerCase().includes(item.collectionSite.toLowerCase()))) {
        current.push({ name: `Collect · ${item.collectionSite}`, address: undefined, orderId: undefined, latitude: undefined, longitude: undefined, plannedArrivalUtc: undefined });
      }
      current.push({
        orderId: item.order.id,
        name: `Deliver · ${item.customer} · ${item.destination || item.depotId || item.order.reference}`,
        address: item.address || undefined,
        latitude: undefined,
        longitude: undefined,
        plannedArrivalUtc: undefined,
      });
      await api.updateLoadStops(load.id, current, await token());
      setSelectedLoadId(load.id);
      setSelectedJobId(undefined);
      await Promise.all([ordersApi.refresh(), loadsApi.refresh()]);
      const mixed = runPeriod(load) !== "TBC" && item.period !== "TBC" && runPeriod(load) !== item.period;
      setMessage(`${item.collectionSite} → ${item.destination} added to Run ${runNumberById.get(load.id) || ""}.${mixed ? ` Check timing: this mixes ${runPeriod(load)} and ${item.period} work.` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The job could not be added to the run.");
    } finally {
      setBusy(false);
    }
  }

  const droppedId = (event: DragEvent) => event.dataTransfer.getData("text/slh-order-id") || event.dataTransfer.getData("text/plain");

  const mapItems = selectedLoad
    ? safeStops(selectedLoad).filter((stop) => text(stop.address)).map((stop) => ({ name: text(stop.name), address: text(stop.address) }))
    : visibleJobs.filter((item) => item.address).slice(0, 20).map((item) => ({ name: item.destination || item.customer, address: item.address }));
  const mapQuery = selectedJob?.address || selectedJob?.destination || mapItems[0]?.address || "United Kingdom";

  const renderJobs = (period: Period, items: Job[]) => items.length ? <>
    <div style={{ fontWeight: 800, padding: "7px 8px", borderRadius: 7, background: period === "TBC" ? "#fff8e9" : "#eef4f5", color: period === "TBC" ? "#7b5100" : "#073a5a" }}>
      {period === "TBC" ? "TIME TBC" : `${period} JOBS`} · {items.length}
    </div>
    {items.map((item) => <article
      key={item.order.id}
      className="op-job-card"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/slh-order-id", item.order.id);
        event.dataTransfer.setData("text/plain", item.order.id);
      }}
      onClick={() => setSelectedJobId(item.order.id)}
      style={selectedJobId === item.order.id ? { border: "2px solid #a53a3a" } : undefined}
    >
      <div className="op-job-heading"><strong>{item.customer}</strong><span>{item.period}{item.planningTime ? ` · ${item.planningTime}` : ""}</span></div>
      <div style={{ margin: "7px 0", display: "grid", gap: 4 }}>
        <div><small style={{ color: "#607685" }}>COLLECT</small><br /><b>{item.collectionSite}</b></div>
        <div style={{ color: "#78909c", fontWeight: 700 }}>↓</div>
        <div><small style={{ color: "#607685" }}>DELIVER</small><br /><b>{item.destination || item.depotId || item.order.reference}</b></div>
      </div>
      <small>{item.address || "Address / map point pending"}</small>
      <div className="op-job-meta">
        <span>{item.orderType}</span>
        <span>{item.orderType.toLowerCase().includes("crate") ? `${Number(item.order.pallets) || 0} units` : `${Number(item.order.pallets) || 0} plt`}</span>
        <span>{text(item.order.reference)}</span>
        {item.customerRef && <span>Ref {item.customerRef}</span>}
        {item.poRef && <span>PO {item.poRef}</span>}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }} onClick={(event) => event.stopPropagation()}>
        <button className="primary" disabled={busy} onClick={() => void createRun(item.order.id)}>Create run</button>
        <button disabled={busy || !selectedLoad} onClick={() => selectedLoad && void addToRun(selectedLoad, item.order.id)}>
          {selectedLoad ? `Add to Run ${runNumberById.get(selectedLoad.id) || ""}` : "Select run first"}
        </button>
      </div>
    </article>)}
  </> : null;

  const renderRunGroup = (period: Period) => {
    const group = sortedLoads.filter((load) => runPeriod(load) === period);
    if (!group.length) return null;
    return <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 800, padding: "7px 8px", borderRadius: 7, background: period === "TBC" ? "#fff8e9" : "#eef4f5", color: period === "TBC" ? "#7b5100" : "#073a5a" }}>
        {period === "TBC" ? "TIME TBC" : `${period} RUNS`} · {group.length}
      </div>
      {group.map((load) => {
        const stops = safeStops(load);
        const number = runNumberById.get(load.id) || 0;
        return <article
          key={load.id}
          className={`op-run-card ${selectedLoadId === load.id ? "selected" : ""}`}
          onClick={() => setSelectedLoadId(load.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const id = droppedId(event);
            if (id) void addToRun(load, id);
          }}
        >
          <div className="op-run-heading"><div><strong>Run {number}</strong><small>{period} · {text(load.status) || "Draft"}</small></div><span>{stops.length} stops</span></div>
          <small style={{ color: "#8a9aa2" }}>{text(load.reference)}</small>
          <div className="op-run-route">{stops.map((stop) => text(stop.name) || "Stop").join(" → ") || "Drop a job here"}</div>
          <Link to="/loads" onClick={(event) => event.stopPropagation()}>Allocate / dispatch →</Link>
        </article>;
      })}
    </div>;
  };

  return <section className="operational-planner">
    <div className="op-planner-header">
      <div>
        <p className="eyebrow">Operational planning</p>
        <h1>Plan the day by time and run</h1>
        <p>AM, PM and time-TBC work stay visible, runs are numbered from 1, and the map is isolated from the previous Azure renderer crash path.</p>
      </div>
      <div className="op-header-actions">
        <label>Plan date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedLoadId(undefined); setSelectedJobId(undefined); }} /></label>
        <button disabled={busy} onClick={() => { void ordersApi.refresh(); void loadsApi.refresh(); }}>{busy ? "Working…" : "Refresh"}</button>
      </div>
    </div>

    <div className="op-metrics">
      <span><strong>{jobs.length}</strong> jobs to plan</span>
      <span><strong>{amJobs.length}</strong> AM</span>
      <span><strong>{pmJobs.length}</strong> PM</span>
      <span><strong>{tbcJobs.length}</strong> time TBC</span>
      <span><strong>{loads.length}</strong> runs</span>
    </div>

    {message && <p className="notice inline-notice">{message}</p>}
    {(ordersApi.error || loadsApi.error) && <p className="notice inline-notice">{ordersApi.error || loadsApi.error}</p>}

    <div className="op-workspace">
      <section className="op-runs-column">
        <div className="op-column-heading"><div><p className="eyebrow">Runs</p><h2>Run builder</h2></div><span>{loads.length}</span></div>
        <div className="op-new-run" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = droppedId(event); if (id) void createRun(id); }}>＋ Drop a job here to create the next run</div>
        <div className="op-run-list">
          {renderRunGroup("AM")}
          {renderRunGroup("PM")}
          {renderRunGroup("TBC")}
          {!loads.length && !loadsApi.loading && <p className="op-empty">No runs yet. Create Run 1 from a Ready to Plan job.</p>}
        </div>
      </section>

      <section className="op-map-panel">
        <div className="op-column-heading"><div><p className="eyebrow">Map</p><h2>{selectedLoad ? `Run ${runNumberById.get(selectedLoad.id) || ""}` : selectedJob ? selectedJob.destination : "Planning locations"}</h2></div><span>{mapItems.length} addresses</span></div>
        <div style={{ minHeight: 500, display: "flex", flexDirection: "column" }}>
          <iframe
            title="Planning map"
            src={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`}
            style={{ border: 0, width: "100%", minHeight: 390, flex: 1 }}
            loading="lazy"
          />
          <div style={{ maxHeight: 145, overflow: "auto", padding: 10, borderTop: "1px solid #dce7ea", background: "#fff" }}>
            {mapItems.length ? mapItems.map((item, index) => <div key={`${item.address}-${index}`} style={{ marginBottom: 7 }}>
              <strong>{item.name || `Stop ${index + 1}`}</strong> · <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`} target="_blank" rel="noreferrer">{item.address}</a>
            </div>) : <span>No mapped delivery address is available yet. Select a job to centre the map on its destination.</span>}
          </div>
        </div>
      </section>

      <section className="op-jobs-column">
        <div className="op-column-heading"><div><p className="eyebrow">Jobs</p><h2>Ready to plan</h2></div><span>{visibleJobs.length}</span></div>
        <input className="op-job-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search time, collection, delivery, customer, PO…" />
        <div className="op-job-list">
          {renderJobs("AM", amJobs)}
          {renderJobs("PM", pmJobs)}
          {renderJobs("TBC", tbcJobs)}
          {!visibleJobs.length && !ordersApi.loading && <p className="op-empty">No unplanned jobs for this date.</p>}
        </div>
      </section>
    </div>
  </section>;
}
