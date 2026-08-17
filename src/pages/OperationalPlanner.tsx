import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import * as atlas from "azure-maps-control";
import "azure-maps-control/dist/atlas.min.css";
import { api, type Driver, type Load, type LoadStop, type Site, type Trailer, type TransportOrder, type Vehicle } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import "../operational-planner.css";

type Coordinate = { latitude: number; longitude: number };
type RouteLine = [number, number][];

type JobView = {
  order: TransportOrder;
  customer: string;
  collectionSite: string;
  depotId: string;
  destination: string;
  deliveryAddress: string;
  customerRef: string;
  poRef: string;
  palletName: string;
};

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function safeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function meaningful(value?: string) {
  const text = safeText(value);
  return text && !["market", "unknown", "n/a", "na", "-", "—"].includes(text.toLowerCase()) ? text : "";
}

function tagged(notes: string | undefined, label: string) {
  if (!notes) return "";
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = notes.match(new RegExp(`${escaped}\\s*:\\s*([^·|\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function jobView(order: TransportOrder): JobView {
  const notes = order.driverInstructions;
  return {
    order,
    customer: meaningful(order.customerCode) || "Customer not identified",
    collectionSite: meaningful(order.sellerName) || tagged(notes, "Collection site"),
    depotId: meaningful(order.marketName) || tagged(notes, "Depot ID"),
    destination: meaningful(order.stallNumber) || tagged(notes, "Depot"),
    deliveryAddress: tagged(notes, "Delivery address"),
    customerRef: tagged(notes, "Customer ref"),
    poRef: tagged(notes, "PO ref"),
    palletName: tagged(notes, "Pallet"),
  };
}

function coordinateFrom(value: unknown): Coordinate | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const point = coordinateFrom(item);
      if (point) return point;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const lat = Number(record.latitude ?? record.lat);
  const lon = Number(record.longitude ?? record.lon ?? record.lng);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
    return { latitude: lat, longitude: lon };
  if (record.position && typeof record.position === "object") {
    const point = coordinateFrom(record.position);
    if (point) return point;
  }
  for (const child of Object.values(record)) {
    const point = coordinateFrom(child);
    if (point) return point;
  }
  return undefined;
}

function distance(a: Coordinate, b: Coordinate) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earth = 6371;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function siteMatch(sites: Site[], name: string) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return undefined;
  return sites.find((site) => {
    const values = [site.externalCode, site.name, site.driverTextName, ...(site.aliases || "").split(/[,;|]/)];
    return values.some((value) => safeText(value).toLowerCase().replace(/[^a-z0-9]/g, "") === key);
  });
}

async function geocodeAddress(address: string, accessToken: string): Promise<Coordinate | undefined> {
  if (!address) return undefined;
  try {
    return coordinateFrom(await api.geocode(address, accessToken));
  } catch {
    return undefined;
  }
}

function stopCoordinate(stop: LoadStop): Coordinate | undefined {
  if (stop.latitude == null || stop.longitude == null) return undefined;
  const latitude = Number(stop.latitude);
  const longitude = Number(stop.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : undefined;
}

function statusLabel(status: string) {
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function JobCard({ job, draggable = true, onSelect }: { job: JobView; draggable?: boolean; onSelect: () => void }) {
  const order = job.order;
  return (
    <article
      className="op-job-card"
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/slh-order-id", order.id);
      }}
      onClick={onSelect}
    >
      <div className="op-job-heading"><strong>{job.customer}</strong><span>{order.pallets ?? 0} plt</span></div>
      <b>{job.destination || job.depotId || order.reference}</b>
      <small>{job.depotId ? `${job.depotId} · ` : ""}{job.deliveryAddress || "Map point pending"}</small>
      <div className="op-job-meta"><span>{order.reference}</span>{job.customerRef && <span>Ref {job.customerRef}</span>}</div>
    </article>
  );
}

function RunCard({
  load,
  vehicles,
  drivers,
  trailers,
  selected,
  busy,
  onSelect,
  onDropOrder,
  onAllocate,
  onSuggest,
}: {
  load: Load;
  vehicles: Vehicle[];
  drivers: Driver[];
  trailers: Trailer[];
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDropOrder: (orderId: string) => Promise<void>;
  onAllocate: (vehicleId?: string, driverId?: string, trailerId?: string) => Promise<void>;
  onSuggest: () => Promise<void>;
}) {
  const [vehicleId, setVehicleId] = useState(load.vehicleId || "");
  const [driverId, setDriverId] = useState(load.driverId || "");
  const [trailerId, setTrailerId] = useState(load.trailerId || "");
  useEffect(() => { setVehicleId(load.vehicleId || ""); setDriverId(load.driverId || ""); setTrailerId(load.trailerId || ""); }, [load.driverId, load.trailerId, load.vehicleId]);
  const stops = Array.isArray(load.stops) ? load.stops : [];
  return (
    <article
      className={`op-run-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const orderId = event.dataTransfer.getData("text/slh-order-id");
        if (orderId) void onDropOrder(orderId);
      }}
    >
      <div className="op-run-heading"><div><strong>{load.reference}</strong><small>{statusLabel(load.status)}</small></div><span>{stops.length} stops</span></div>
      <div className="op-run-route">
        {stops.length ? stops.map((stop) => stop.name || "Unnamed stop").join(" → ") : "Drop a job here"}
      </div>
      <div className="op-allocation" onClick={(event) => event.stopPropagation()}>
        <select value={vehicleId} onChange={(event) => { const value = event.target.value; setVehicleId(value); void onAllocate(value || undefined, driverId || undefined, trailerId || undefined); }} disabled={busy}>
          <option value="">Vehicle</option>{vehicles.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.registration}</option>)}
        </select>
        <select value={driverId} onChange={(event) => { const value = event.target.value; setDriverId(value); void onAllocate(vehicleId || undefined, value || undefined, trailerId || undefined); }} disabled={busy}>
          <option value="">Driver</option>{drivers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
        </select>
        <select value={trailerId} onChange={(event) => { const value = event.target.value; setTrailerId(value); void onAllocate(vehicleId || undefined, driverId || undefined, value || undefined); }} disabled={busy}>
          <option value="">Trailer</option>{trailers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.trailerNumber}</option>)}
        </select>
      </div>
      <button type="button" className="op-suggest" disabled={busy || stops.length < 2} onClick={(event) => { event.stopPropagation(); void onSuggest(); }}>Suggest stop order</button>
    </article>
  );
}

function PlannerMap({ jobs, loads, selectedLoadId, geocodes, route }: { jobs: JobView[]; loads: Load[]; selectedLoadId?: string; geocodes: Record<string, Coordinate | null>; route: RouteLine }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const mapsClientId = import.meta.env.VITE_AZURE_MAPS_CLIENT_ID;
  const appClientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
  const selectedLoad = loads.find((load) => load.id === selectedLoadId);
  const points = useMemo(() => {
    const jobPoints = jobs.flatMap((job) => {
      const point = geocodes[job.deliveryAddress];
      return point ? [{ ...point, label: job.destination || job.depotId || job.customer, kind: "job" }] : [];
    });
    const runPoints = (selectedLoad?.stops || []).flatMap((stop) => {
      const point = stopCoordinate(stop) || geocodes[stop.address || ""];
      return point ? [{ ...point, label: stop.name, kind: "run" }] : [];
    });
    return [...jobPoints, ...runPoints];
  }, [geocodes, jobs, selectedLoad]);

  useEffect(() => {
    if (!container.current || !mapsClientId || !appClientId || !tenantId) return;
    setError(undefined);
    let map: atlas.Map | undefined;
    try {
      map = new atlas.Map(container.current, {
        authOptions: { authType: atlas.AuthenticationType.aad, clientId: mapsClientId, aadAppId: appClientId, aadTenant: tenantId },
        center: [-1.4, 52.9],
        zoom: 6,
      });
      map.events.add("ready", () => {
        try {
          if (!map) return;
          const source = new atlas.source.DataSource();
          map.sources.add(source);
          for (const point of points) source.add(new atlas.data.Feature(new atlas.data.Point([point.longitude, point.latitude]), { label: point.label, kind: point.kind }));
          if (route.length > 1) source.add(new atlas.data.Feature(new atlas.data.LineString(route), { kind: "route" }));
          map.layers.add(new atlas.layer.LineLayer(source, undefined, { strokeColor: "#007979", strokeWidth: 5, strokeOpacity: .85, filter: ["==", ["get", "kind"], "route"] }));
          map.layers.add(new atlas.layer.BubbleLayer(source, undefined, {
            color: ["match", ["get", "kind"], "run", "#006d6c", "#e3912e"], radius: ["match", ["get", "kind"], "run", 9, 7], strokeColor: "#fff", strokeWidth: 2, filter: ["!=", ["get", "kind"], "route"],
          }));
          map.layers.add(new atlas.layer.SymbolLayer(source, undefined, { textField: ["get", "label"], textOffset: [0, 1.3], textSize: 11, textColor: "#17344a", filter: ["!=", ["get", "kind"], "route"] }));
          const camera = [...points.map((point) => [point.longitude, point.latitude] as [number, number]), ...route];
          if (camera.length > 1) map.setCamera({ bounds: atlas.data.BoundingBox.fromPositions(camera), padding: 55 });
          else if (camera.length === 1) map.setCamera({ center: camera[0], zoom: 11 });
        } catch (mapError) {
          setError(mapError instanceof Error ? mapError.message : "Map drawing failed.");
        }
      });
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : "Map could not initialise.");
    }
    return () => map?.dispose();
  }, [appClientId, mapsClientId, points, route, tenantId]);

  return (
    <section className="op-map-panel">
      <div className="op-column-heading"><div><p className="eyebrow">Map</p><h2>Jobs & selected run</h2></div><span>{points.length} points</span></div>
      {error && <p className="notice inline-notice">Map: {error}</p>}
      {mapsClientId ? <div ref={container} className="op-azure-map" /> : <div className="op-map-empty">Azure Maps client ID is not configured.</div>}
      <div className="op-map-legend"><span><i className="run-dot" />Selected run</span><span><i className="job-dot" />Unplanned jobs</span></div>
    </section>
  );
}

export function OperationalPlanner() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const [selectedLoadId, setSelectedLoadId] = useState<string>();
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [geocodes, setGeocodes] = useState<Record<string, Coordinate | null>>({});
  const [route, setRoute] = useState<RouteLine>([]);

  const ordersApi = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token]));
  const loadsApi = useApi(useCallback(async () => api.loads(date, await token()), [date, token]));
  const vehiclesApi = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const driversApi = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const trailersApi = useApi(useCallback(async () => api.trailers(await token()), [token]));
  const sitesApi = useApi(useCallback(async () => api.sites(await token()), [token]));

  const loads = useMemo(() => (Array.isArray(loadsApi.data) ? loadsApi.data : []).map((load) => ({ ...load, stops: Array.isArray(load.stops) ? load.stops : [] })), [loadsApi.data]);
  const usedOrderIds = useMemo(() => new Set(loads.flatMap((load) => load.stops.flatMap((stop) => stop.orderId ? [stop.orderId] : []))), [loads]);
  const jobs = useMemo(() => (Array.isArray(ordersApi.data) ? ordersApi.data : [])
    .filter((order) => !usedOrderIds.has(order.id) && !["Cancelled", "Delivered"].includes(order.status))
    .map(jobView), [ordersApi.data, usedOrderIds]);
  const visibleJobs = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return jobs.filter((job) => !query || [job.customer, job.collectionSite, job.depotId, job.destination, job.deliveryAddress, job.customerRef, job.order.reference].some((value) => value.toLowerCase().includes(query)));
  }, [filter, jobs]);
  const selectedJob = jobs.find((job) => job.order.id === selectedJobId);
  const selectedLoad = loads.find((load) => load.id === selectedLoadId);

  const refresh = useCallback(async () => {
    await Promise.all([ordersApi.refresh(), loadsApi.refresh(), vehiclesApi.refresh(), driversApi.refresh(), trailersApi.refresh(), sitesApi.refresh()]);
  }, [driversApi, loadsApi, ordersApi, sitesApi, trailersApi, vehiclesApi]);

  useEffect(() => {
    const unresolved = [...new Set(visibleJobs.map((job) => job.deliveryAddress).filter(Boolean))]
      .filter((address) => !(address in geocodes)).slice(0, 60);
    if (!unresolved.length) return;
    let cancelled = false;
    void (async () => {
      const accessToken = await token();
      const entries = await Promise.all(unresolved.map(async (address) => [address, (await geocodeAddress(address, accessToken)) || null] as const));
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
        const coordinates = result.routes?.[0]?.legs?.flatMap((leg) => (leg.points || []).flatMap((point) => point.latitude != null && point.longitude != null ? [[point.longitude, point.latitude] as [number, number]] : [])) || [];
        if (!cancelled) setRoute(coordinates);
      } catch { if (!cancelled) setRoute([]); }
    })();
    return () => { cancelled = true; };
  }, [selectedLoadId, loads, token]);

  async function buildStops(job: JobView, existing: LoadStop[] = []) {
    const accessToken = await token();
    const sites = sitesApi.data || [];
    const site = siteMatch(sites, job.collectionSite);
    const result: Array<{ orderId?: string; name: string; address?: string; latitude?: number; longitude?: number }> = [];
    if (job.collectionSite && !existing.some((stop) => safeText(stop.name).toLowerCase().includes(job.collectionSite.toLowerCase()))) {
      let point = site?.latitude != null && site.longitude != null ? { latitude: Number(site.latitude), longitude: Number(site.longitude) } : undefined;
      const address = site?.collectionAddress || job.collectionSite;
      point ||= await geocodeAddress(address, accessToken);
      result.push({ name: `Collect · ${job.collectionSite}`, address: site?.collectionAddress || undefined, latitude: point?.latitude, longitude: point?.longitude });
    }
    const deliveryAddress = job.deliveryAddress || job.destination || job.depotId;
    let deliveryPoint = deliveryAddress ? geocodes[deliveryAddress] || undefined : undefined;
    deliveryPoint ||= deliveryAddress ? await geocodeAddress(deliveryAddress, accessToken) : undefined;
    if (deliveryAddress && !(deliveryAddress in geocodes)) setGeocodes((current) => ({ ...current, [deliveryAddress]: deliveryPoint || null }));
    result.push({ orderId: job.order.id, name: `${job.customer} · ${job.destination || job.depotId || job.order.reference}`, address: job.deliveryAddress || job.destination || undefined, latitude: deliveryPoint?.latitude, longitude: deliveryPoint?.longitude });
    return result;
  }

  async function addJobToRun(load: Load, orderId: string) {
    const job = jobs.find((item) => item.order.id === orderId);
    if (!job || busy) return;
    setBusy(load.id); setMessage(undefined); setSelectedLoadId(load.id);
    try {
      const current = Array.isArray(load.stops) ? load.stops : [];
      const additions = await buildStops(job, current);
      await api.updateLoadStops(load.id, [...current, ...additions].map((stop) => ({ orderId: stop.orderId, name: stop.name, address: stop.address, latitude: stop.latitude, longitude: stop.longitude, plannedArrivalUtc: stop.plannedArrivalUtc })), await token());
      await Promise.all([loadsApi.refresh(), ordersApi.refresh()]);
      setMessage(`${job.customer} added to ${load.reference}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The job could not be added to the run."); }
    finally { setBusy(undefined); }
  }

  async function createRun(orderId: string) {
    const job = jobs.find((item) => item.order.id === orderId);
    if (!job || busy) return;
    setBusy("new"); setMessage(undefined);
    try {
      const stops = await buildStops(job);
      const load = await api.createLoad({
        reference: `RUN-${date.replaceAll("-", "")}-${String(loads.length + 1).padStart(2, "0")}`,
        planningDate: date,
        palletSpacesUsed: job.order.pallets || 0,
        capacityType: "Standard pallets",
        stops,
      }, await token());
      setSelectedLoadId(load.id);
      await Promise.all([loadsApi.refresh(), ordersApi.refresh()]);
      setMessage(`New run created for ${job.customer}. Drag more jobs onto it.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The run could not be created."); }
    finally { setBusy(undefined); }
  }

  async function allocate(load: Load, vehicleId?: string, driverId?: string, trailerId?: string) {
    if (busy) return;
    setBusy(load.id); setMessage(undefined);
    try { await api.allocateLoad(load.id, { vehicleId, driverId, trailerId }, await token()); await loadsApi.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Allocation could not be saved."); }
    finally { setBusy(undefined); }
  }

  async function suggestOrder(load: Load) {
    if (busy) return;
    setBusy(load.id); setMessage(undefined);
    try {
      const accessToken = await token();
      const enriched = await Promise.all((load.stops || []).map(async (stop) => {
        let point = stopCoordinate(stop);
        if (!point && stop.address) point = await geocodeAddress(stop.address, accessToken);
        return { stop, point };
      }));
      const firstCollectionIndex = enriched.findIndex((item) => item.stop.name.toLowerCase().startsWith("collect"));
      const first = firstCollectionIndex >= 0 ? enriched.splice(firstCollectionIndex, 1)[0] : enriched.shift();
      const ordered = first ? [first] : [];
      while (enriched.length) {
        const origin = ordered.at(-1)?.point;
        if (!origin) { ordered.push(...enriched.splice(0)); break; }
        enriched.sort((a, b) => a.point && b.point ? distance(origin, a.point) - distance(origin, b.point) : a.point ? -1 : b.point ? 1 : 0);
        ordered.push(enriched.shift()!);
      }
      await api.updateLoadStops(load.id, ordered.map(({ stop, point }) => ({ orderId: stop.orderId, name: stop.name, address: stop.address, latitude: point?.latitude ?? stop.latitude, longitude: point?.longitude ?? stop.longitude, plannedArrivalUtc: stop.plannedArrivalUtc })), accessToken);
      await loadsApi.refresh();
      setSelectedLoadId(load.id);
      setMessage(`${load.reference} stop order suggested from the available map points.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Route suggestion could not be saved."); }
    finally { setBusy(undefined); }
  }

  const loading = ordersApi.loading || loadsApi.loading;
  const error = ordersApi.error || loadsApi.error;

  return (
    <section className="operational-planner">
      <div className="op-planner-header">
        <div><p className="eyebrow">Operational planning</p><h1>Build the day visually</h1><p>Drag customer jobs into runs, see every mapped destination, then allocate the run.</p></div>
        <div className="op-header-actions"><label>Plan date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedLoadId(undefined); setSelectedJobId(undefined); }} /></label><button onClick={() => void refresh()}>Refresh</button></div>
      </div>
      <div className="op-metrics"><span><strong>{jobs.length}</strong> jobs to plan</span><span><strong>{loads.length}</strong> runs</span><span><strong>{loads.filter((load) => !load.vehicleId || !load.driverId).length}</strong> need allocation</span></div>
      {message && <p className="notice inline-notice">{message}</p>}
      {error && <p className="notice inline-notice">Planner data: {error}</p>}
      {loading && !ordersApi.data && !loadsApi.data && <p className="state">Loading planning data…</p>}

      <div className="op-workspace">
        <section className="op-runs-column">
          <div className="op-column-heading"><div><p className="eyebrow">Runs</p><h2>Run builder</h2></div><span>{loads.length}</span></div>
          <div
            className="op-new-run"
            onDragOver={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
            onDrop={(event) => { event.preventDefault(); const orderId = event.dataTransfer.getData("text/slh-order-id"); if (orderId) void createRun(orderId); }}
          >＋ Drop a job here to create a run</div>
          <div className="op-run-list">
            {loads.map((load) => <RunCard key={load.id} load={load} vehicles={vehiclesApi.data || []} drivers={driversApi.data || []} trailers={trailersApi.data || []} selected={load.id === selectedLoadId} busy={Boolean(busy)} onSelect={() => setSelectedLoadId(load.id)} onDropOrder={(orderId) => addJobToRun(load, orderId)} onAllocate={(vehicleId, driverId, trailerId) => allocate(load, vehicleId, driverId, trailerId)} onSuggest={() => suggestOrder(load)} />)}
            {!loads.length && <p className="op-empty">No runs yet. Drag a job into the box above.</p>}
          </div>
        </section>

        <PlannerMap jobs={visibleJobs} loads={loads} selectedLoadId={selectedLoadId} geocodes={geocodes} route={route} />

        <section className="op-jobs-column">
          <div className="op-column-heading"><div><p className="eyebrow">Jobs</p><h2>Ready to plan</h2></div><span>{visibleJobs.length}</span></div>
          <input className="op-job-search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search customer, depot, postcode, order…" />
          {selectedJob && <aside className="op-selected-job"><strong>{selectedJob.customer}</strong><span>{selectedJob.collectionSite ? `Collect ${selectedJob.collectionSite}` : "Collection site not mapped"}</span><span>{selectedJob.destination || selectedJob.depotId || "Destination not mapped"}</span><span>{selectedJob.deliveryAddress || "Delivery address not supplied"}</span></aside>}
          <div className="op-job-list">{visibleJobs.map((job) => <JobCard key={job.order.id} job={job} onSelect={() => setSelectedJobId(job.order.id)} />)}{!visibleJobs.length && <p className="op-empty">No unplanned jobs for this date.</p>}</div>
        </section>
      </div>
      <p className="op-footnote">Orange pins are unplanned delivery jobs. Teal pins and route line are the selected run. A job is removed from the right-hand queue as soon as it is attached to a saved run.</p>
    </section>
  );
}
