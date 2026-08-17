import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import * as atlas from "azure-maps-control";
import "azure-maps-control/dist/atlas.min.css";
import { api, type CreateLoad, type Load, type LoadStop, type Site, type TransportOrder } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import "../operational-planner.css";

type Coordinate = { latitude: number; longitude: number };
type PlannerStop = CreateLoad["stops"][number];
type RouteLine = [number, number][];
type Job = {
  order: TransportOrder;
  customer: string;
  collectionSite: string;
  depotId: string;
  destination: string;
  deliveryAddress: string;
  customerRef: string;
};

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function text(value: unknown) { return String(value ?? "").trim(); }
function tagged(notes: string | undefined, label: string) {
  const prefix = `${label}:`;
  return (notes || "").split("·").map((part) => part.trim()).find((part) => part.toLowerCase().startsWith(prefix.toLowerCase()))?.slice(prefix.length).trim() || "";
}
function job(order: TransportOrder): Job {
  return {
    order,
    customer: text(order.customerCode) || "Customer not identified",
    collectionSite: text(order.sellerName) || tagged(order.driverInstructions, "Collection site"),
    depotId: text(order.marketName) || tagged(order.driverInstructions, "Depot ID"),
    destination: text(order.stallNumber) || tagged(order.driverInstructions, "Depot"),
    deliveryAddress: tagged(order.driverInstructions, "Delivery address"),
    customerRef: tagged(order.driverInstructions, "Customer ref"),
  };
}
function normal(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function siteFor(sites: Site[], name: string) {
  const key = normal(name);
  return sites.find((site) => [site.externalCode, site.name, site.driverTextName, ...(site.aliases || "").split(/[,;|]/)].some((value) => normal(text(value)) === key));
}
function coordinateFrom(value: unknown): Coordinate | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const coordinate = coordinateFrom(item); if (coordinate) return coordinate; }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const latitude = Number(record.latitude ?? record.lat);
  const longitude = Number(record.longitude ?? record.lon ?? record.lng);
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
  for (const child of Object.values(record)) { const coordinate = coordinateFrom(child); if (coordinate) return coordinate; }
  return undefined;
}
async function geocode(address: string, accessToken: string) {
  if (!address.trim()) return undefined;
  try { return coordinateFrom(await api.geocode(address, accessToken)); } catch { return undefined; }
}
function stopCoordinate(stop: LoadStop) {
  const latitude = Number(stop.latitude);
  const longitude = Number(stop.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : undefined;
}

function PlannerMap({ jobs, selectedLoad, route, geocodes }: { jobs: Job[]; selectedLoad?: Load; route: RouteLine; geocodes: Record<string, Coordinate | null> }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const mapsClientId = import.meta.env.VITE_AZURE_MAPS_CLIENT_ID;
  const appClientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
  const points = useMemo(() => {
    const unplanned = jobs.flatMap((item) => {
      const point = geocodes[item.deliveryAddress];
      return point ? [{ ...point, label: item.destination || item.depotId || item.customer, kind: "job" }] : [];
    });
    const run = (selectedLoad?.stops || []).flatMap((stop) => {
      const point = stopCoordinate(stop) || geocodes[stop.address || ""];
      return point ? [{ ...point, label: stop.name, kind: "run" }] : [];
    });
    return [...unplanned, ...run];
  }, [geocodes, jobs, selectedLoad]);

  useEffect(() => {
    if (!container.current || !mapsClientId || !appClientId || !tenantId) return;
    let map: atlas.Map | undefined;
    setError(undefined);
    try {
      map = new atlas.Map(container.current, {
        authOptions: { authType: atlas.AuthenticationType.aad, clientId: mapsClientId, aadAppId: appClientId, aadTenant: tenantId },
        center: [-1.4, 52.9], zoom: 6,
      });
      map.events.add("ready", () => {
        try {
          if (!map) return;
          const source = new atlas.source.DataSource();
          map.sources.add(source);
          points.forEach((point) => source.add(new atlas.data.Feature(new atlas.data.Point([point.longitude, point.latitude]), { label: point.label, kind: point.kind })));
          if (route.length > 1) source.add(new atlas.data.Feature(new atlas.data.LineString(route), { kind: "route" }));
          map.layers.add(new atlas.layer.LineLayer(source, undefined, { strokeColor: "#007979", strokeWidth: 5, filter: ["==", ["get", "kind"], "route"] }));
          map.layers.add(new atlas.layer.BubbleLayer(source, undefined, { color: ["match", ["get", "kind"], "run", "#006d6c", "#e3912e"], radius: 8, strokeColor: "#fff", strokeWidth: 2, filter: ["!=", ["get", "kind"], "route"] }));
          map.layers.add(new atlas.layer.SymbolLayer(source, undefined, { textField: ["get", "label"], textOffset: [0, 1.25], textSize: 11, filter: ["!=", ["get", "kind"], "route"] }));
          const camera = [...points.map((point) => [point.longitude, point.latitude] as [number, number]), ...route];
          if (camera.length > 1) map.setCamera({ bounds: atlas.data.BoundingBox.fromPositions(camera), padding: 55 });
          else if (camera.length === 1) map.setCamera({ center: camera[0], zoom: 11 });
        } catch (exception) { setError(exception instanceof Error ? exception.message : "Map drawing failed."); }
      });
    } catch (exception) { setError(exception instanceof Error ? exception.message : "Map could not initialise."); }
    return () => map?.dispose();
  }, [appClientId, mapsClientId, points, route, tenantId]);

  return <section className="op-map-panel">
    <div className="op-column-heading"><div><p className="eyebrow">Map</p><h2>Jobs & selected run</h2></div><span>{points.length} points</span></div>
    {error && <p className="notice inline-notice">Map: {error}</p>}
    {mapsClientId ? <div ref={container} className="op-azure-map" /> : <div className="op-map-empty">Azure Maps is not configured.</div>}
    <div className="op-map-legend"><span><i className="run-dot" />Selected run</span><span><i className="job-dot" />Unplanned jobs</span></div>
  </section>;
}

export function OperationalPlanner() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const [filter, setFilter] = useState("");
  const [selectedLoadId, setSelectedLoadId] = useState<string>();
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [geocodes, setGeocodes] = useState<Record<string, Coordinate | null>>({});
  const [route, setRoute] = useState<RouteLine>([]);

  const ordersApi = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token]));
  const loadsApi = useApi(useCallback(async () => api.loads(date, await token()), [date, token]));
  const vehiclesApi = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const driversApi = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const trailersApi = useApi(useCallback(async () => api.trailers(await token()), [token]));
  const sitesApi = useApi(useCallback(async () => api.sites(await token()), [token]));

  const loads = useMemo(() => (loadsApi.data || []).map((load) => ({ ...load, stops: Array.isArray(load.stops) ? load.stops : [] })), [loadsApi.data]);
  const plannedIds = useMemo(() => new Set(loads.flatMap((load) => load.stops.flatMap((stop) => stop.orderId ? [stop.orderId] : []))), [loads]);
  const jobs = useMemo(() => (ordersApi.data || []).filter((order) => !plannedIds.has(order.id) && !["Cancelled", "Delivered"].includes(order.status)).map(job), [ordersApi.data, plannedIds]);
  const visibleJobs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return jobs.filter((item) => !q || [item.order.reference, item.customer, item.collectionSite, item.depotId, item.destination, item.deliveryAddress, item.customerRef].some((value) => value.toLowerCase().includes(q)));
  }, [filter, jobs]);
  const selectedLoad = loads.find((load) => load.id === selectedLoadId);
  const selectedJob = jobs.find((item) => item.order.id === selectedJobId);

  useEffect(() => {
    const addresses = [...new Set(visibleJobs.map((item) => item.deliveryAddress).filter(Boolean))].filter((address) => !(address in geocodes)).slice(0, 40);
    if (!addresses.length) return;
    let cancelled = false;
    void (async () => {
      const accessToken = await token();
      const entries = await Promise.all(addresses.map(async (address) => [address, (await geocode(address, accessToken)) || null] as const));
      if (!cancelled) setGeocodes((current) => ({ ...current, ...Object.fromEntries(entries) }));
    })();
    return () => { cancelled = true; };
  }, [geocodes, token, visibleJobs]);

  useEffect(() => {
    if (!selectedLoadId) { setRoute([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.route(selectedLoadId, await token()) as { routes?: Array<{ legs?: Array<{ points?: Array<{ latitude?: number; longitude?: number }> }> }> };
        const line = result.routes?.[0]?.legs?.flatMap((leg) => (leg.points || []).flatMap((point) => point.latitude != null && point.longitude != null ? [[point.longitude, point.latitude] as [number, number]] : [])) || [];
        if (!cancelled) setRoute(line);
      } catch { if (!cancelled) setRoute([]); }
    })();
    return () => { cancelled = true; };
  }, [selectedLoadId, token]);

  async function stopsFor(item: Job, existing: LoadStop[] = []): Promise<PlannerStop[]> {
    const accessToken = await token();
    const result: PlannerStop[] = [];
    const site = item.collectionSite ? siteFor(sitesApi.data || [], item.collectionSite) : undefined;
    if (item.collectionSite && !existing.some((stop) => stop.name.toLowerCase().includes(item.collectionSite.toLowerCase()))) {
      const address = site?.collectionAddress || item.collectionSite;
      const point = site?.latitude != null && site.longitude != null ? { latitude: Number(site.latitude), longitude: Number(site.longitude) } : await geocode(address, accessToken);
      result.push({ name: `Collect · ${item.collectionSite}`, address: site?.collectionAddress || undefined, latitude: point?.latitude, longitude: point?.longitude });
    }
    const address = item.deliveryAddress || item.destination || item.depotId;
    let point = address ? geocodes[address] || undefined : undefined;
    point ||= address ? await geocode(address, accessToken) : undefined;
    if (address) setGeocodes((current) => ({ ...current, [address]: point || null }));
    result.push({ orderId: item.order.id, name: `${item.customer} · ${item.destination || item.depotId || item.order.reference}`, address: item.deliveryAddress || item.destination || undefined, latitude: point?.latitude, longitude: point?.longitude });
    return result;
  }

  async function createRun(orderId: string) {
    const item = jobs.find((candidate) => candidate.order.id === orderId);
    if (!item || busy) return;
    setBusy(true); setMessage(undefined);
    try {
      const stops = await stopsFor(item);
      const load = await api.createLoad({ reference: `RUN-${date.replaceAll("-", "")}-${String(loads.length + 1).padStart(2, "0")}`, planningDate: date, palletSpacesUsed: item.order.pallets || 0, capacityType: "Standard pallets", stops }, await token());
      setSelectedLoadId(load.id);
      await Promise.all([ordersApi.refresh(), loadsApi.refresh()]);
      setMessage(`New run created for ${item.customer}.`);
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Run could not be created."); }
    finally { setBusy(false); }
  }

  async function addToRun(load: Load, orderId: string) {
    const item = jobs.find((candidate) => candidate.order.id === orderId);
    if (!item || busy) return;
    setBusy(true); setMessage(undefined); setSelectedLoadId(load.id);
    try {
      const current = load.stops || [];
      const additions = await stopsFor(item, current);
      const stops: PlannerStop[] = [...current.map((stop) => ({ orderId: stop.orderId, name: stop.name, address: stop.address, latitude: stop.latitude, longitude: stop.longitude, plannedArrivalUtc: stop.plannedArrivalUtc })), ...additions];
      await api.updateLoadStops(load.id, stops, await token());
      await Promise.all([ordersApi.refresh(), loadsApi.refresh()]);
      setMessage(`${item.customer} added to ${load.reference}.`);
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Job could not be added to the run."); }
    finally { setBusy(false); }
  }

  async function allocate(load: Load, vehicleId?: string, driverId?: string, trailerId?: string) {
    if (busy) return;
    setBusy(true); setMessage(undefined);
    try { await api.allocateLoad(load.id, { vehicleId, driverId, trailerId }, await token()); await loadsApi.refresh(); }
    catch (exception) { setMessage(exception instanceof Error ? exception.message : "Allocation could not be saved."); }
    finally { setBusy(false); }
  }

  async function suggest(load: Load) {
    if (busy || load.stops.length < 2) return;
    setBusy(true); setMessage(undefined);
    try {
      const accessToken = await token();
      const enriched = await Promise.all(load.stops.map(async (stop) => ({ stop, point: stopCoordinate(stop) || (stop.address ? await geocode(stop.address, accessToken) : undefined) })));
      const collection = enriched.filter((item) => item.stop.name.toLowerCase().startsWith("collect"));
      const deliveries = enriched.filter((item) => !item.stop.name.toLowerCase().startsWith("collect"));
      const ordered = [...collection, ...deliveries.sort((a, b) => (a.point?.longitude || 0) - (b.point?.longitude || 0))];
      await api.updateLoadStops(load.id, ordered.map(({ stop, point }) => ({ orderId: stop.orderId, name: stop.name, address: stop.address, latitude: point?.latitude ?? stop.latitude, longitude: point?.longitude ?? stop.longitude, plannedArrivalUtc: stop.plannedArrivalUtc })), accessToken);
      await loadsApi.refresh(); setSelectedLoadId(load.id); setMessage(`${load.reference} stop order updated using the available map points.`);
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Route suggestion could not be saved."); }
    finally { setBusy(false); }
  }

  function RunCard({ load }: { load: Load }) {
    const [vehicleId, setVehicleId] = useState(load.vehicleId || "");
    const [driverId, setDriverId] = useState(load.driverId || "");
    const [trailerId, setTrailerId] = useState(load.trailerId || "");
    useEffect(() => { setVehicleId(load.vehicleId || ""); setDriverId(load.driverId || ""); setTrailerId(load.trailerId || ""); }, [load.driverId, load.trailerId, load.vehicleId]);
    return <article className={`op-run-card ${selectedLoadId === load.id ? "selected" : ""}`} onClick={() => setSelectedLoadId(load.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const id = event.dataTransfer.getData("text/slh-order-id"); if (id) void addToRun(load, id); }}>
      <div className="op-run-heading"><div><strong>{load.reference}</strong><small>{load.status}</small></div><span>{load.stops.length} stops</span></div>
      <div className="op-run-route">{load.stops.map((stop) => stop.name).join(" → ") || "Drop a job here"}</div>
      <div className="op-allocation" onClick={(event) => event.stopPropagation()}>
        <select value={vehicleId} disabled={busy} onChange={(event) => { const value = event.target.value; setVehicleId(value); void allocate(load, value || undefined, driverId || undefined, trailerId || undefined); }}><option value="">Vehicle</option>{(vehiclesApi.data || []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.registration}</option>)}</select>
        <select value={driverId} disabled={busy} onChange={(event) => { const value = event.target.value; setDriverId(value); void allocate(load, vehicleId || undefined, value || undefined, trailerId || undefined); }}><option value="">Driver</option>{(driversApi.data || []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>
        <select value={trailerId} disabled={busy} onChange={(event) => { const value = event.target.value; setTrailerId(value); void allocate(load, vehicleId || undefined, driverId || undefined, value || undefined); }}><option value="">Trailer</option>{(trailersApi.data || []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.trailerNumber}</option>)}</select>
      </div>
      <button className="op-suggest" disabled={busy || load.stops.length < 2} onClick={(event) => { event.stopPropagation(); void suggest(load); }}>Suggest stop order</button>
    </article>;
  }

  return <section className="operational-planner">
    <div className="op-planner-header"><div><p className="eyebrow">Operational planning</p><h1>Build the day visually</h1><p>Drag customer jobs into runs, map the destinations, then allocate the run.</p></div><div className="op-header-actions"><label>Plan date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedLoadId(undefined); setSelectedJobId(undefined); }} /></label><button onClick={() => { void ordersApi.refresh(); void loadsApi.refresh(); }}>Refresh</button></div></div>
    <div className="op-metrics"><span><strong>{jobs.length}</strong> jobs to plan</span><span><strong>{loads.length}</strong> runs</span><span><strong>{loads.filter((load) => !load.driverId || !load.vehicleId).length}</strong> need allocation</span></div>
    {message && <p className="notice inline-notice">{message}</p>}
    {(ordersApi.error || loadsApi.error) && <p className="notice inline-notice">{ordersApi.error || loadsApi.error}</p>}
    <div className="op-workspace">
      <section className="op-runs-column"><div className="op-column-heading"><div><p className="eyebrow">Runs</p><h2>Run builder</h2></div><span>{loads.length}</span></div><div className="op-new-run" onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/slh-order-id"); if (id) void createRun(id); }}>＋ Drop a job here to create a run</div><div className="op-run-list">{loads.map((load) => <RunCard key={load.id} load={load} />)}{!loads.length && <p className="op-empty">No runs yet.</p>}</div></section>
      <PlannerMap jobs={visibleJobs} selectedLoad={selectedLoad} route={route} geocodes={geocodes} />
      <section className="op-jobs-column"><div className="op-column-heading"><div><p className="eyebrow">Jobs</p><h2>Ready to plan</h2></div><span>{visibleJobs.length}</span></div><input className="op-job-search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search customer, depot, postcode, order…" />{selectedJob && <aside className="op-selected-job"><strong>{selectedJob.customer}</strong><span>{selectedJob.collectionSite ? `Collect ${selectedJob.collectionSite}` : "Collection site not mapped"}</span><span>{selectedJob.destination || selectedJob.depotId || "Destination not mapped"}</span><span>{selectedJob.deliveryAddress || "Delivery address not supplied"}</span></aside>}<div className="op-job-list">{visibleJobs.map((item) => <article key={item.order.id} className="op-job-card" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/slh-order-id", item.order.id); }} onClick={() => setSelectedJobId(item.order.id)}><div className="op-job-heading"><strong>{item.customer}</strong><span>{item.order.pallets ?? 0} plt</span></div><b>{item.destination || item.depotId || item.order.reference}</b><small>{item.depotId ? `${item.depotId} · ` : ""}{item.deliveryAddress || "Map point pending"}</small><div className="op-job-meta"><span>{item.order.reference}</span>{item.customerRef && <span>Ref {item.customerRef}</span>}</div></article>)}{!visibleJobs.length && <p className="op-empty">No unplanned jobs for this date.</p>}</div></section>
    </div>
  </section>;
}