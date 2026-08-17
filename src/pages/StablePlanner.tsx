import { useCallback, useMemo, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api, type Load, type LoadStop, type TransportOrder } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import "../operational-planner.css";

type Job = {
  order: TransportOrder;
  customer: string;
  collectionSite: string;
  depotId: string;
  destination: string;
  address: string;
  customerRef: string;
};

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

function asJob(order: TransportOrder): Job {
  return {
    order,
    customer: text(order.customerCode) || "Customer not identified",
    collectionSite: text(order.sellerName) || tagged(order.driverInstructions, "Collection site"),
    depotId: text(order.marketName) || tagged(order.driverInstructions, "Depot ID"),
    destination: text(order.stallNumber) || tagged(order.driverInstructions, "Depot"),
    address: tagged(order.driverInstructions, "Delivery address"),
    customerRef: tagged(order.driverInstructions, "Customer ref"),
  };
}

function safeStops(load: Load): LoadStop[] {
  return safeArray<LoadStop>(load?.stops).filter((stop) => stop && typeof stop === "object");
}

export function StablePlanner() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const [query, setQuery] = useState("");
  const [selectedLoadId, setSelectedLoadId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const ordersApi = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token]));
  const loadsApi = useApi(useCallback(async () => api.loads(date, await token()), [date, token]));

  const loads = useMemo(
    () => safeArray<Load>(loadsApi.data).map((load) => ({ ...load, stops: safeStops(load) })),
    [loadsApi.data],
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
    if (!q) return jobs;
    return jobs.filter((item) => [
      item.order.reference,
      item.customer,
      item.collectionSite,
      item.depotId,
      item.destination,
      item.address,
      item.customerRef,
    ].some((value) => text(value).toLowerCase().includes(q)));
  }, [jobs, query]);

  const selectedLoad = loads.find((load) => load.id === selectedLoadId);

  async function createRun(orderId: string) {
    const item = jobs.find((candidate) => candidate.order.id === orderId);
    if (!item || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const stops = [] as Array<{ orderId?: string; name: string; address?: string }>;
      if (item.collectionSite) {
        stops.push({ name: `Collect · ${item.collectionSite}` });
      }
      stops.push({
        orderId: item.order.id,
        name: `${item.customer} · ${item.destination || item.depotId || item.order.reference}`,
        address: item.address || undefined,
      });
      const created = await api.createLoad({
        reference: `RUN-${date.replaceAll("-", "")}-${String(loads.length + 1).padStart(2, "0")}`,
        planningDate: date,
        palletSpacesUsed: Number(item.order.pallets) || 0,
        capacityType: "Standard pallets",
        stops,
      }, await token());
      setSelectedLoadId(created.id);
      await Promise.all([ordersApi.refresh(), loadsApi.refresh()]);
      setMessage(`${item.customer} added to a new run.`);
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
      if (item.collectionSite && !current.some((stop) => text(stop.name).toLowerCase().includes(item.collectionSite.toLowerCase()))) {
        current.push({ name: `Collect · ${item.collectionSite}`, address: undefined, orderId: undefined, latitude: undefined, longitude: undefined, plannedArrivalUtc: undefined });
      }
      current.push({
        orderId: item.order.id,
        name: `${item.customer} · ${item.destination || item.depotId || item.order.reference}`,
        address: item.address || undefined,
        latitude: undefined,
        longitude: undefined,
        plannedArrivalUtc: undefined,
      });
      await api.updateLoadStops(load.id, current, await token());
      setSelectedLoadId(load.id);
      await Promise.all([ordersApi.refresh(), loadsApi.refresh()]);
      setMessage(`${item.customer} added to ${load.reference}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The job could not be added to the run.");
    } finally {
      setBusy(false);
    }
  }

  const mapJobs = selectedLoad
    ? safeStops(selectedLoad).filter((stop) => text(stop.address))
    : visibleJobs.filter((item) => item.address).slice(0, 12).map((item) => ({ name: item.destination || item.customer, address: item.address }));

  return <section className="operational-planner">
    <div className="op-planner-header">
      <div>
        <p className="eyebrow">Operational planning</p>
        <h1>Build the day</h1>
        <p>Drag jobs into runs. This planner is isolated from the legacy planner so malformed data cannot throw you out of the portal.</p>
      </div>
      <div className="op-header-actions">
        <label>Plan date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedLoadId(undefined); }} /></label>
        <button onClick={() => { void ordersApi.refresh(); void loadsApi.refresh(); }}>Refresh</button>
      </div>
    </div>

    <div className="op-metrics">
      <span><strong>{jobs.length}</strong> jobs to plan</span>
      <span><strong>{loads.length}</strong> runs</span>
      <span><strong>{loads.filter((load) => !load.driverId || !load.vehicleId).length}</strong> need allocation</span>
    </div>

    {message && <p className="notice inline-notice">{message}</p>}
    {(ordersApi.error || loadsApi.error) && <p className="notice inline-notice">{ordersApi.error || loadsApi.error}</p>}

    <div className="op-workspace">
      <section className="op-runs-column">
        <div className="op-column-heading"><div><p className="eyebrow">Runs</p><h2>Run builder</h2></div><span>{loads.length}</span></div>
        <div className="op-new-run" onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/slh-order-id"); if (id) void createRun(id); }}>＋ Drop a job here to create a run</div>
        <div className="op-run-list">
          {loads.map((load) => {
            const stops = safeStops(load);
            return <article key={load.id} className={`op-run-card ${selectedLoadId === load.id ? "selected" : ""}`} onClick={() => setSelectedLoadId(load.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const id = event.dataTransfer.getData("text/slh-order-id"); if (id) void addToRun(load, id); }}>
              <div className="op-run-heading"><div><strong>{text(load.reference) || "Unnamed run"}</strong><small>{text(load.status) || "Draft"}</small></div><span>{stops.length} stops</span></div>
              <div className="op-run-route">{stops.map((stop) => text(stop.name) || "Stop").join(" → ") || "Drop a job here"}</div>
              <Link to="/loads" onClick={(event) => event.stopPropagation()}>Allocate / dispatch →</Link>
            </article>;
          })}
          {!loads.length && !loadsApi.loading && <p className="op-empty">No runs yet.</p>}
        </div>
      </section>

      <section className="op-map-panel">
        <div className="op-column-heading"><div><p className="eyebrow">Map</p><h2>{selectedLoad ? selectedLoad.reference : "Jobs to map"}</h2></div><span>{mapJobs.length} addresses</span></div>
        <div className="panel" style={{ minHeight: 360 }}>
          <p className="intro">Map points are resolved from the delivery addresses. Open any address below in Maps while the Azure map renderer is kept isolated from the planner crash path.</p>
          {mapJobs.length ? mapJobs.map((item, index) => {
            const address = text("address" in item ? item.address : "");
            const name = text("name" in item ? item.name : "");
            return <div key={`${name}-${address}-${index}`} style={{ marginBottom: 12 }}>
              <strong>{name || `Stop ${index + 1}`}</strong><br />
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">{address}</a>
            </div>;
          }) : <p className="op-empty">No usable delivery addresses are present for this selection yet.</p>}
        </div>
      </section>

      <section className="op-jobs-column">
        <div className="op-column-heading"><div><p className="eyebrow">Jobs</p><h2>Ready to plan</h2></div><span>{visibleJobs.length}</span></div>
        <input className="op-job-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, depot, postcode, order…" />
        <div className="op-job-list">
          {visibleJobs.map((item) => <article key={item.order.id} className="op-job-card" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/slh-order-id", item.order.id); }}>
            <div className="op-job-heading"><strong>{item.customer}</strong><span>{Number(item.order.pallets) || 0} plt</span></div>
            <b>{item.destination || item.depotId || text(item.order.reference) || "Destination pending"}</b>
            <small>{item.depotId ? `${item.depotId} · ` : ""}{item.address || "Address / map point pending"}</small>
            <div className="op-job-meta"><span>{text(item.order.reference)}</span>{item.customerRef && <span>Ref {item.customerRef}</span>}</div>
          </article>)}
          {!visibleJobs.length && !ordersApi.loading && <p className="op-empty">No unplanned jobs for this date.</p>}
        </div>
      </section>
    </div>
  </section>;
}
