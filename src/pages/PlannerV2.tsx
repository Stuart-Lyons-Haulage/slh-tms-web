import {
  Component,
  type DragEvent,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as atlas from "azure-maps-control";
import "azure-maps-control/dist/atlas.min.css";
import {
  api,
  type CreateLoad,
  type Driver,
  type Load,
  type LoadStop,
  type Site,
  type Trailer,
  type TransportOrder,
  type Vehicle,
} from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { plannerV2Api, type PlannerDaySuggestion } from "../lib/plannerV2Api";
import { useApi } from "../lib/useApi";
import "../operational-planner.css";

type Coordinate = { latitude: number; longitude: number };
type RouteLine = [number, number][];
type PlannerStop = CreateLoad["stops"][number];
type RouteLeg = { points?: Array<{ latitude?: number; longitude?: number }> };
type PlannerJob = {
  order: TransportOrder;
  customer: string;
  collectionSite: string;
  depotId: string;
  destination: string;
  deliveryAddress: string;
  customerRef: string;
  poRef: string;
  product: string;
  orderType: string;
};
type MapPoint = Coordinate & {
  label: string;
  kind: "collection" | "delivery" | "run" | "selected";
};

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const safeArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value.filter(Boolean) as T[] : [];
const text = (value: unknown) => String(value ?? "").trim();
const normal = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]/g, "");

function tagged(notes: string | undefined, label: string) {
  const prefix = `${label}:`;
  return (notes || "").split("·").map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(prefix.toLowerCase()))
    ?.slice(prefix.length).trim() || "";
}

function asJob(order: TransportOrder): PlannerJob {
  const explicitType = tagged(order.driverInstructions, "Order type");
  const orderType = explicitType || (/\bcrate(s)?\b/i.test(`${order.driverInstructions || ""} ${order.stallNumber || ""}`) ? "Crates" : "Pallets");
  return {
    order,
    customer: text(order.customerCode) || "Customer not identified",
    collectionSite: text(order.sellerName) || tagged(order.driverInstructions, "Collection site") || "Collection not mapped",
    depotId: text(order.marketName) || tagged(order.driverInstructions, "Depot ID"),
    destination: text(order.stallNumber) || tagged(order.driverInstructions, "Depot") || "Destination not mapped",
    deliveryAddress: tagged(order.driverInstructions, "Delivery address"),
    customerRef: tagged(order.driverInstructions, "Customer ref"),
    poRef: tagged(order.driverInstructions, "PO ref"),
    product: tagged(order.driverInstructions, "Pallet") || tagged(order.driverInstructions, "Product"),
    orderType,
  };
}

function safeStops(load?: Load) {
  return safeArray<LoadStop>(load?.stops).filter((stop) => stop && typeof stop === "object");
}

function siteFor(sites: Site[], name: string) {
  const key = normal(name);
  if (!key) return undefined;
  return sites.find((site) => [site.externalCode, site.name, site.driverTextName, ...(site.aliases || "").split(/[,;|]/)]
    .some((candidate) => normal(candidate) === key));
}

function coordinateFrom(value: unknown): Coordinate | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = coordinateFrom(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const latitude = Number(record.latitude ?? record.lat);
  const longitude = Number(record.longitude ?? record.lon ?? record.lng);
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    return { latitude, longitude };
  }
  for (const child of Object.values(record)) {
    const found = coordinateFrom(child);
    if (found) return found;
  }
  return undefined;
}

function stopCoordinate(stop: LoadStop): Coordinate | undefined {
  const latitude = Number(stop.latitude);
  const longitude = Number(stop.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : undefined;
}

function siteCoordinate(site?: Site): Coordinate | undefined {
  if (site?.latitude == null || site.longitude == null) return undefined;
  const latitude = Number(site.latitude);
  const longitude = Number(site.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : undefined;
}

function capacityUnits(job: PlannerJob) {
  return job.orderType.toLowerCase().includes("crate") ? 0 : Math.max(0, Number(job.order.pallets) || 0);
}

function hours(minutes?: number) {
  if (minutes == null) return "hours unknown";
  return `${Math.floor(minutes / 60)}h ${String(Math.abs(minutes % 60)).padStart(2, "0")}m drive left`;
}

function fleetioAvailable(vehicle: Vehicle) {
  const status = text(vehicle.fleetioStatus).toLowerCase();
  return !status || !["out of service", "out-of-service", "inactive", "sold", "vor"].some((phrase) => status.includes(phrase));
}

async function geocode(address: string, accessToken: string) {
  if (!address.trim()) return undefined;
  try { return coordinateFrom(await api.geocode(address, accessToken)); }
  catch { return undefined; }
}

function distanceScore(a?: Coordinate, b?: Coordinate) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return (a.latitude - b.latitude) ** 2 + (a.longitude - b.longitude) ** 2;
}

class MapBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Planner V2 map failed", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="op-map-empty"><div style={{ maxWidth: 520, padding: 24 }}>
      <strong>Map renderer unavailable</strong>
      <p>The run builder remains usable and the map failure is isolated from the Planner.</p>
      <small>{this.state.error.message}</small>
    </div></div>;
  }
}

function PlannerMap({ jobs, sites, selectedLoad, selectedJobId, geocodes, route }: {
  jobs: PlannerJob[];
  sites: Site[];
  selectedLoad?: Load;
  selectedJobId?: string;
  geocodes: Record<string, Coordinate | null>;
  route: RouteLine;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<atlas.Map | undefined>(undefined);
  const sourceRef = useRef<atlas.source.DataSource | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const mapsClientId = import.meta.env.VITE_AZURE_MAPS_CLIENT_ID;
  const appClientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;

  const points = useMemo<MapPoint[]>(() => {
    const result: MapPoint[] = [];
    const seenCollections = new Set<string>();
    for (const item of jobs) {
      const site = siteFor(sites, item.collectionSite);
      const collectionAddress = site?.collectionAddress || item.collectionSite;
      const collection = siteCoordinate(site) || geocodes[collectionAddress];
      const collectionKey = normal(item.collectionSite);
      if (collection && collectionKey && !seenCollections.has(collectionKey)) {
        seenCollections.add(collectionKey);
        result.push({ ...collection, label: `Collect · ${item.collectionSite}`, kind: "collection" });
      }
      const delivery = geocodes[item.deliveryAddress || item.destination];
      if (delivery) result.push({
        ...delivery,
        label: item.destination || item.depotId || item.customer,
        kind: item.order.id === selectedJobId ? "selected" : "delivery",
      });
    }
    for (const stop of safeStops(selectedLoad)) {
      const point = stopCoordinate(stop) || geocodes[text(stop.address)];
      if (point) result.push({ ...point, label: text(stop.name) || "Run stop", kind: "run" });
    }
    return result;
  }, [geocodes, jobs, selectedJobId, selectedLoad, sites]);

  useEffect(() => {
    if (!container.current || !mapsClientId || !appClientId || !tenantId) return;
    let disposed = false;
    try {
      const map = new atlas.Map(container.current, {
        authOptions: { authType: atlas.AuthenticationType.aad, clientId: mapsClientId, aadAppId: appClientId, aadTenant: tenantId },
        center: [-1.35, 52.7],
        zoom: 6,
      });
      mapRef.current = map;
      map.events.add("ready", () => {
        if (disposed) return;
        try {
          const source = new atlas.source.DataSource();
          sourceRef.current = source;
          map.sources.add(source);
          map.layers.add(new atlas.layer.LineLayer(source, "planner-v2-route", { strokeColor: "#007979", strokeWidth: 5, filter: ["==", ["get", "kind"], "route"] }));
          map.layers.add(new atlas.layer.BubbleLayer(source, "planner-v2-delivery", { color: "#e3912e", radius: 8, strokeColor: "#fff", strokeWidth: 2, filter: ["==", ["get", "kind"], "delivery"] }));
          map.layers.add(new atlas.layer.BubbleLayer(source, "planner-v2-collection", { color: "#315f86", radius: 9, strokeColor: "#fff", strokeWidth: 2, filter: ["==", ["get", "kind"], "collection"] }));
          map.layers.add(new atlas.layer.BubbleLayer(source, "planner-v2-run", { color: "#007979", radius: 10, strokeColor: "#fff", strokeWidth: 2, filter: ["==", ["get", "kind"], "run"] }));
          map.layers.add(new atlas.layer.BubbleLayer(source, "planner-v2-selected", { color: "#a53a3a", radius: 12, strokeColor: "#fff", strokeWidth: 3, filter: ["==", ["get", "kind"], "selected"] }));
          map.layers.add(new atlas.layer.SymbolLayer(source, "planner-v2-labels", { textField: ["get", "label"], textOffset: [0, 1.25], textSize: 11, filter: ["!=", ["get", "kind"], "route"] }));
          setReady(true);
        } catch (exception) {
          setError(exception instanceof Error ? exception.message : "Map layers could not be created.");
        }
      });
      map.events.add("error", () => { if (!disposed) setError("Azure Maps reported a renderer or authentication error."); });
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Azure Maps could not initialise.");
    }
    return () => {
      disposed = true;
      setReady(false);
      sourceRef.current = undefined;
      try { mapRef.current?.dispose(); } catch { /* best effort */ }
      mapRef.current = undefined;
    };
  }, [appClientId, mapsClientId, tenantId]);

  useEffect(() => {
    const source = sourceRef.current;
    const map = mapRef.current;
    if (!ready || !source || !map) return;
    try {
      source.clear();
      points.forEach((point) => source.add(new atlas.data.Feature(
        new atlas.data.Point([point.longitude, point.latitude]),
        { label: point.label, kind: point.kind },
      )));
      if (route.length > 1) source.add(new atlas.data.Feature(new atlas.data.LineString(route), { kind: "route" }));
      const camera = [...points.map((point) => [point.longitude, point.latitude] as [number, number]), ...route];
      if (camera.length > 1) map.setCamera({ bounds: atlas.data.BoundingBox.fromPositions(camera), padding: 70 });
      else if (camera.length === 1) map.setCamera({ center: camera[0], zoom: 11 });
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Map points could not be drawn.");
    }
  }, [points, ready, route]);

  if (!mapsClientId || !appClientId || !tenantId) return <div className="op-map-empty"><div style={{ padding: 24 }}><strong>Map configuration incomplete</strong><p>The run builder remains available.</p></div></div>;
  if (error) return <div className="op-map-empty"><div style={{ padding: 24 }}><strong>Map unavailable</strong><p>{error}</p><small>The Planner remains usable.</small></div></div>;
  return <div ref={container} className="op-azure-map" />;
}

export function PlannerV2() {
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
  const suggestionsApi = useApi(useCallback(async () => plannerV2Api.daySuggestions(date, await token()), [date, token]));

  const sites = useMemo(() => safeArray<Site>(sitesApi.data), [sitesApi.data]);
  const vehicles = useMemo(() => safeArray<Vehicle>(vehiclesApi.data), [vehiclesApi.data]);
  const drivers = useMemo(() => safeArray<Driver>(driversApi.data), [driversApi.data]);
  const trailers = useMemo(() => safeArray<Trailer>(trailersApi.data), [trailersApi.data]);
  const loads = useMemo(() => safeArray<Load>(loadsApi.data).map((load) => ({ ...load, stops: safeStops(load) })), [loadsApi.data]);
  const plannedIds = useMemo(() => new Set(loads.flatMap((load) => safeStops(load).flatMap((stop) => stop.orderId ? [stop.orderId] : []))), [loads]);
  const jobs = useMemo(() => safeArray<TransportOrder>(ordersApi.data)
    .filter((order) => order?.id && !plannedIds.has(order.id))
    .filter((order) => !["Cancelled", "Delivered"].includes(text(order.status)))
    .map(asJob), [ordersApi.data, plannedIds]);
  const visibleJobs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const result = q ? jobs.filter((item) => [item.order.reference, item.customer, item.collectionSite, item.depotId, item.destination, item.deliveryAddress, item.customerRef, item.poRef, item.orderType]
      .some((value) => text(value).toLowerCase().includes(q))) : jobs;
    return [...result].sort((a, b) => a.collectionSite.localeCompare(b.collectionSite) || a.destination.localeCompare(b.destination));
  }, [filter, jobs]);
  const suggestions = useMemo(() => safeArray<PlannerDaySuggestion>(suggestionsApi.data?.suggestions), [suggestionsApi.data]);
  const selectedLoad = loads.find((load) => load.id === selectedLoadId);
  const selectedJob = jobs.find((item) => item.order.id === selectedJobId);

  useEffect(() => {
    const addresses = new Set<string>();
    visibleJobs.forEach((item) => {
      if (item.deliveryAddress) addresses.add(item.deliveryAddress);
      const site = siteFor(sites, item.collectionSite);
      if (!siteCoordinate(site) && site?.collectionAddress) addresses.add(site.collectionAddress);
    });
    const pending = [...addresses].filter((address) => !(address in geocodes)).slice(0, 100);
    if (!pending.length) return;
    let cancelled = false;
    void (async () => {
      const accessToken = await token();
      const resolved: Array<readonly [string, Coordinate | null]> = [];
      for (let index = 0; index < pending.length; index += 8) {
        const entries = await Promise.all(pending.slice(index, index + 8).map(async (address) => [address, (await geocode(address, accessToken)) || null] as const));
        resolved.push(...entries);
        if (cancelled) return;
      }
      if (!cancelled) setGeocodes((current) => ({ ...current, ...Object.fromEntries(resolved) }));
    })();
    return () => { cancelled = true; };
  }, [geocodes, sites, token, visibleJobs]);

  useEffect(() => {
    if (!selectedLoadId) { setRoute([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.route(selectedLoadId, await token()) as { routes?: Array<{ legs?: RouteLeg[] }> };
        const legs: RouteLeg[] = result.routes?.[0]?.legs ?? [];
        const line: RouteLine = legs.flatMap((leg) => (leg.points ?? []).flatMap((point) => point.latitude != null && point.longitude != null
          ? [[Number(point.longitude), Number(point.latitude)] as [number, number]] : []));
        if (!cancelled) setRoute(line);
      } catch { if (!cancelled) setRoute([]); }
    })();
    return () => { cancelled = true; };
  }, [selectedLoadId, token]);

  async function stopsFor(item: PlannerJob, existing: LoadStop[] = []): Promise<PlannerStop[]> {
    const accessToken = await token();
    const result: PlannerStop[] = [];
    const site = siteFor(sites, item.collectionSite);
    const collectionAddress = site?.collectionAddress || item.collectionSite;
    const hasCollection = existing.some((stop) => normal(stop.name).includes(normal(item.collectionSite)) || normal(stop.address) === normal(collectionAddress));
    if (item.collectionSite !== "Collection not mapped" && !hasCollection) {
      const point = siteCoordinate(site) || geocodes[collectionAddress] || await geocode(collectionAddress, accessToken);
      if (collectionAddress && !(collectionAddress in geocodes)) setGeocodes((current) => ({ ...current, [collectionAddress]: point || null }));
      result.push({ name: `Collect · ${item.collectionSite}`, address: site?.collectionAddress || undefined, latitude: point?.latitude, longitude: point?.longitude });
    }
    const deliveryAddress = item.deliveryAddress || item.destination || item.depotId;
    let point = deliveryAddress ? geocodes[deliveryAddress] || undefined : undefined;
    point ||= deliveryAddress ? await geocode(deliveryAddress, accessToken) : undefined;
    if (deliveryAddress) setGeocodes((current) => ({ ...current, [deliveryAddress]: point || null }));
    result.push({ orderId: item.order.id, name: `Deliver · ${item.customer} · ${item.destination || item.depotId || item.order.reference}`, address: item.deliveryAddress || item.destination || undefined, latitude: point?.latitude, longitude: point?.longitude });
    return result;
  }

  async function createRun(orderId: string, suggestedDriverId?: string) {
    const item = jobs.find((candidate) => candidate.order.id === orderId);
    if (!item || busy) return;
    setBusy(true); setMessage(undefined);
    try {
      const created = await api.createLoad({
        reference: `RUN-${date.replaceAll("-", "")}-${Date.now().toString().slice(-5)}`,
        planningDate: date,
        driverId: suggestedDriverId,
        palletSpacesUsed: capacityUnits(item),
        totalPalletSpaces: 26,
        capacityType: "Standard pallets",
        plannerNotes: `Created in Planner V2 · ${item.orderType}`,
        stops: await stopsFor(item),
      }, await token());
      setSelectedLoadId(created.id); setSelectedJobId(undefined);
      await Promise.all([ordersApi.refresh(), loadsApi.refresh(), suggestionsApi.refresh()]);
      setMessage(`${item.collectionSite} → ${item.destination} added to ${created.reference}.`);
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "The run could not be created."); }
    finally { setBusy(false); }
  }

  async function addToRun(load: Load, orderId: string) {
    const item = jobs.find((candidate) => candidate.order.id === orderId);
    if (!item || busy) return;
    setBusy(true); setMessage(undefined); setSelectedLoadId(load.id);
    try {
      const current = safeStops(load);
      const stops: PlannerStop[] = [...current.map((stop) => ({ orderId: stop.orderId, name: text(stop.name) || "Stop", address: text(stop.address) || undefined, latitude: stop.latitude, longitude: stop.longitude, plannedArrivalUtc: stop.plannedArrivalUtc })), ...await stopsFor(item, current)];
      await api.updateLoadStops(load.id, stops, await token());
      await api.updateLoadUtilisation(load.id, {
        palletSpacesUsed: (Number(load.palletSpacesUsed) || 0) + capacityUnits(item),
        totalPalletSpaces: Number(load.totalPalletSpaces) || 26,
        capacityType: load.capacityType || "Standard pallets",
        plannerNotes: load.plannerNotes,
      }, await token());
      setSelectedJobId(undefined);
      await Promise.all([ordersApi.refresh(), loadsApi.refresh(), suggestionsApi.refresh()]);
      setMessage(`${item.collectionSite} → ${item.destination} added to ${load.reference}.`);
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "The job could not be added to the run."); }
    finally { setBusy(false); }
  }

  async function allocate(load: Load, vehicleId?: string, driverId?: string, trailerId?: string) {
    if (busy) return;
    setBusy(true); setMessage(undefined);
    try {
      await api.allocateLoad(load.id, { vehicleId, driverId, trailerId }, await token());
      if (trailerId) {
        const trailer = trailers.find((item) => item.id === trailerId);
        await api.updateLoadUtilisation(load.id, {
          palletSpacesUsed: Number(load.palletSpacesUsed) || 0,
          totalPalletSpaces: Number(trailer?.standardCapacity) || Number(load.totalPalletSpaces) || 26,
          capacityType: trailer?.type || load.capacityType || "Standard pallets",
          plannerNotes: load.plannerNotes,
        }, await token());
      }
      await Promise.all([loadsApi.refresh(), suggestionsApi.refresh()]);
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Allocation could not be saved."); }
    finally { setBusy(false); }
  }

  async function suggestStopOrder(load: Load) {
    const currentStops = safeStops(load);
    if (busy || currentStops.length < 2) return;
    setBusy(true); setMessage(undefined);
    try {
      const accessToken = await token();
      const enriched = await Promise.all(currentStops.map(async (stop) => ({ stop, point: stopCoordinate(stop) || (stop.address ? await geocode(stop.address, accessToken) : undefined) })));
      const ordered = enriched.filter((item) => text(item.stop.name).toLowerCase().startsWith("collect"));
      const remaining = enriched.filter((item) => !text(item.stop.name).toLowerCase().startsWith("collect"));
      let cursor = ordered.map((item) => item.point).filter((point): point is Coordinate => Boolean(point)).at(-1);
      while (remaining.length) {
        let nextIndex = 0; let best = Number.POSITIVE_INFINITY;
        remaining.forEach((candidate, index) => { const score = distanceScore(cursor, candidate.point); if (score < best) { best = score; nextIndex = index; } });
        const next = remaining.splice(nextIndex, 1)[0]; ordered.push(next); cursor = next.point || cursor;
      }
      await api.updateLoadStops(load.id, ordered.map(({ stop, point }) => ({ orderId: stop.orderId, name: text(stop.name) || "Stop", address: text(stop.address) || undefined, latitude: point?.latitude ?? stop.latitude, longitude: point?.longitude ?? stop.longitude, plannedArrivalUtc: stop.plannedArrivalUtc })), accessToken);
      await loadsApi.refresh(); setSelectedLoadId(load.id); setMessage(`${load.reference} stop order updated using the available map points.`);
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Route suggestion could not be saved."); }
    finally { setBusy(false); }
  }

  const droppedId = (event: DragEvent) => event.dataTransfer.getData("text/slh-order-id") || event.dataTransfer.getData("text/plain");
  const activeVehicles = vehicles.filter((vehicle) => vehicle.active);
  const activeDrivers = drivers.filter((driver) => driver.active);
  const activeTrailers = trailers.filter((trailer) => trailer.active);

  return <section className="operational-planner planner-v2">
    <div className="op-planner-header"><div><p className="eyebrow">Planner V2</p><h1>Build the day visually</h1><p>Collection → delivery, click or drag run building, resource allocation, route points and previous-day suggestions.</p></div><div className="op-header-actions"><label>Plan date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedLoadId(undefined); setSelectedJobId(undefined); setGeocodes({}); }} /></label><button disabled={busy} onClick={() => { void ordersApi.refresh(); void loadsApi.refresh(); void suggestionsApi.refresh(); }}>{busy ? "Working…" : "Refresh"}</button></div></div>
    <div className="op-metrics"><span><strong>{jobs.length}</strong> jobs to plan</span><span><strong>{loads.length}</strong> runs</span><span><strong>{loads.filter((load) => !load.driverId || !load.vehicleId).length}</strong> need allocation</span><span><strong>{jobs.filter((item) => item.orderType.toLowerCase().includes("crate")).length}</strong> crate jobs</span><span><strong>{suggestions.length}</strong> suggestions</span></div>
    {message && <p className="notice inline-notice">{message}</p>}
    {(ordersApi.error || loadsApi.error || sitesApi.error) && <p className="notice inline-notice">{ordersApi.error || loadsApi.error || sitesApi.error}</p>}

    {suggestions.length > 0 && <section style={{ marginBottom: 12, border: "1px solid #dce7ea", borderRadius: 13, background: "#f7fafb" }}><div className="op-column-heading"><div><p className="eyebrow">SLH Assistant</p><h2>Previous-day positioning suggestions</h2></div><span>{suggestions.length}</span></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 8, padding: 10 }}>{suggestions.slice(0, 6).map((item) => <article className="op-run-card" key={`${item.driverId}-${item.orderId}`}><div className="op-run-heading"><div><strong>{item.driverName}</strong><small>Finished: {item.lastLocation}</small></div><span>{item.repositionMiles == null ? "distance ?" : `${item.repositionMiles} mi`}</span></div><div className="op-run-route"><b>{item.collectionSite}</b> → {item.destination}</div><div className="op-job-meta"><span>{item.orderType}</span><span>{item.orderReference}</span><span>{hours(item.driveAvailableTodayMinutes)}</span></div><p style={{ fontSize: ".75rem", color: "#607685", margin: "7px 0" }}>{item.reason}</p><div style={{ display: "flex", gap: 6 }}><button disabled={busy} onClick={() => { setFilter(item.orderReference); setSelectedJobId(item.orderId); }}>Find job</button><button className="primary" disabled={busy || !jobs.some((job) => job.order.id === item.orderId)} onClick={() => void createRun(item.orderId, item.driverId)}>Build suggested run</button></div></article>)}</div></section>}

    <div className="op-workspace">
      <section className="op-runs-column"><div className="op-column-heading"><div><p className="eyebrow">Runs</p><h2>Driver day builder</h2></div><span>{loads.length}</span></div><div className="op-new-run" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = droppedId(event); if (id) void createRun(id); }}>＋ Drop a job here to create a run</div><div className="op-run-list">{loads.map((load) => {
        const stops = safeStops(load); const selectedTrailer = trailers.find((item) => item.id === load.trailerId); const capacity = Number(load.totalPalletSpaces) || Number(selectedTrailer?.standardCapacity) || 26; const used = Number(load.palletSpacesUsed) || 0; const over = capacity > 0 && used > capacity; const selectedDriver = drivers.find((item) => item.id === load.driverId);
        return <article key={load.id} className={`op-run-card ${selectedLoadId === load.id ? "selected" : ""}`} onClick={() => setSelectedLoadId(load.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const id = droppedId(event); if (id) void addToRun(load, id); }}><div className="op-run-heading"><div><strong>{text(load.reference) || "Unnamed run"}</strong><small>{text(load.status) || "Draft"}</small></div><span>{stops.length} stops</span></div><div className="op-run-route">{stops.map((stop) => text(stop.name) || "Stop").join(" → ") || "Drop a job here"}</div><div style={{ margin: "7px 0" }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: ".72rem", color: over ? "#a53a3a" : "#607685" }}><span>Capacity</span><strong>{used} / {capacity}{over ? " · OVER" : ""}</strong></div><div style={{ height: 6, borderRadius: 6, background: "#e5edef", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, capacity > 0 ? used / capacity * 100 : 0)}%`, background: over ? "#a53a3a" : "#007979" }} /></div></div><div className="op-allocation" onClick={(event) => event.stopPropagation()}><select value={load.vehicleId || ""} disabled={busy} onChange={(event) => void allocate(load, event.target.value || undefined, load.driverId, load.trailerId)}><option value="">Vehicle</option>{activeVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id} disabled={!fleetioAvailable(vehicle)}>{vehicle.registration}{vehicle.fleetioStatus ? ` · ${vehicle.fleetioStatus}` : ""}</option>)}</select><select value={load.driverId || ""} disabled={busy} onChange={(event) => void allocate(load, load.vehicleId, event.target.value || undefined, load.trailerId)}><option value="">Driver</option>{activeDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.displayName}{driver.tachoDriveAvailableTodayMinutes != null ? ` · ${hours(driver.tachoDriveAvailableTodayMinutes)}` : ""}</option>)}</select><select value={load.trailerId || ""} disabled={busy} onChange={(event) => void allocate(load, load.vehicleId, load.driverId, event.target.value || undefined)}><option value="">Trailer</option>{activeTrailers.map((trailer) => <option key={trailer.id} value={trailer.id}>{trailer.trailerNumber}{trailer.standardCapacity ? ` · ${trailer.standardCapacity} plt` : ""}</option>)}</select></div>{selectedDriver && <small style={{ display: "block", marginTop: 5, color: "#607685" }}>{selectedDriver.displayName}: {hours(selectedDriver.tachoDriveAvailableTodayMinutes)}</small>}<button className="op-suggest" disabled={busy || stops.length < 2} onClick={(event) => { event.stopPropagation(); void suggestStopOrder(load); }}>Suggest stop order</button></article>;
      })}{!loads.length && !loadsApi.loading && <p className="op-empty">No runs yet. Create one from a Ready to Plan job.</p>}</div></section>

      <section className="op-map-panel"><div className="op-column-heading"><div><p className="eyebrow">Map</p><h2>{selectedLoad ? selectedLoad.reference : "Collections & deliveries"}</h2></div><span>{selectedLoad ? safeStops(selectedLoad).length : visibleJobs.length}</span></div><MapBoundary><PlannerMap jobs={visibleJobs} sites={sites} selectedLoad={selectedLoad} selectedJobId={selectedJobId} geocodes={geocodes} route={route} /></MapBoundary><div className="op-map-legend"><span><i style={{ background: "#315f86" }} />Collection</span><span><i className="job-dot" />Delivery</span><span><i className="run-dot" />Selected run</span><span><i style={{ background: "#a53a3a" }} />Selected job</span></div></section>

      <section className="op-jobs-column"><div className="op-column-heading"><div><p className="eyebrow">Jobs</p><h2>Ready to plan</h2></div><span>{visibleJobs.length}</span></div><input className="op-job-search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search collection, delivery, customer, PO…" />{selectedJob && <aside className="op-selected-job"><strong>{selectedJob.collectionSite} → {selectedJob.destination}</strong><span>{selectedJob.deliveryAddress || "Delivery address / postcode not mapped"}</span><span>{selectedJob.orderType} · {selectedJob.order.pallets ?? 0} {selectedJob.orderType.toLowerCase().includes("crate") ? "units" : "pallets"}</span></aside>}<div className="op-job-list">{visibleJobs.map((item) => <article key={item.order.id} className="op-job-card" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/slh-order-id", item.order.id); event.dataTransfer.setData("text/plain", item.order.id); }} onClick={() => setSelectedJobId(item.order.id)} style={item.order.id === selectedJobId ? { border: "2px solid #a53a3a" } : undefined}><div className="op-job-heading"><strong>{item.customer}</strong><span>{item.orderType}</span></div><div style={{ margin: "7px 0", display: "grid", gap: 4 }}><div><small style={{ color: "#607685" }}>COLLECT</small><br /><b style={{ margin: 0 }}>{item.collectionSite}</b></div><div style={{ color: "#78909c", fontWeight: 700 }}>↓</div><div><small style={{ color: "#607685" }}>DELIVER</small><br /><b style={{ margin: 0 }}>{item.destination || item.depotId || item.order.reference}</b></div></div><small>{item.deliveryAddress || "Address / map point pending"}</small><div className="op-job-meta"><span>{item.orderType.toLowerCase().includes("crate") ? `${item.order.pallets ?? 0} crate units` : `${item.order.pallets ?? 0} plt`}</span><span>{item.order.reference}</span>{item.customerRef && <span>Ref {item.customerRef}</span>}{item.poRef && <span>PO {item.poRef}</span>}{item.product && <span>{item.product}</span>}</div><div style={{ display: "flex", gap: 6, marginTop: 8 }} onClick={(event) => event.stopPropagation()}><button className="primary" disabled={busy} onClick={() => void createRun(item.order.id)}>Create run</button><button disabled={busy || !selectedLoad} onClick={() => selectedLoad && void addToRun(selectedLoad, item.order.id)}>{selectedLoad ? `Add to ${selectedLoad.reference}` : "Select run first"}</button></div></article>)}{!visibleJobs.length && !ordersApi.loading && <p className="op-empty">No unplanned jobs for this date.</p>}</div></section>
    </div>
  </section>;
}
