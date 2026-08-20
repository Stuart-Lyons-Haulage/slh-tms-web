import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Driver,
  type Load,
  type LoadDispatch,
  type Site,
  type Trailer,
  type Vehicle,
} from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";
import { displayRunReference } from "../lib/runDisplay";
import { useApi } from "../lib/useApi";
import "../runs-capacity-allocation.css";

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

type CapacityType = "Standard pallets" | "Euro pallets" | "Trays" | "Trolleys" | "Mixed load";
type EditableStop = Omit<Load["stops"][number], "latitude" | "longitude"> & { latitude: string; longitude: string; postcode: string };

const normalise = (value?: string) => (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const spaceLabel = (type?: string) => (type || "").toLowerCase() === "euro pallets" ? "Euro spaces" : "floor spaces";
const postcodePattern = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

function loadTypeLabel(type?: string) {
  switch ((type || "").toLowerCase()) {
    case "euro pallets": return "Euro pallet load";
    case "trays": return "Tray load";
    case "trolleys": return "Trolley load";
    case "mixed load": return "Mixed-unit load";
    default: return "Standard pallet load";
  }
}

function capacityTypeFromLoad(value?: string): CapacityType {
  const allowed: CapacityType[] = ["Standard pallets", "Euro pallets", "Trays", "Trolleys", "Mixed load"];
  return allowed.includes(value as CapacityType) ? value as CapacityType : "Mixed load";
}

function trailerCapacity(trailer: Trailer | undefined, type: string) {
  if (!trailer) return undefined;
  return type.toLowerCase() === "euro pallets"
    ? trailer.euroCapacity ?? trailer.standardCapacity
    : trailer.standardCapacity ?? trailer.euroCapacity;
}

function stopSiteName(value: string) {
  return value.replace(/^\s*(collect|deliver)\s*[·:\-]\s*/i, "").replace(/\s*→.*$/, "").trim();
}

function siteAliases(site: Site) {
  return [site.name, site.driverTextName, ...(site.aliases || "").split(/[,;|]/)]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function matchSite(sites: Site[], stopName: string) {
  const target = normalise(stopSiteName(stopName));
  if (!target) return undefined;
  return sites.find(site => siteAliases(site).some(alias => normalise(alias) === target)) ||
    sites.find(site => siteAliases(site).some(alias => {
      const candidate = normalise(alias);
      return candidate.length > 4 && (target.includes(candidate) || candidate.includes(target));
    }));
}

function usefulAddress(value?: string) {
  return Boolean(value && (postcodePattern.test(value) || /\d+\s+[A-Za-z]/.test(value)));
}

function postcodeFrom(value?: string) {
  const match = value?.match(postcodePattern);
  return match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : "";
}

function formatPostcode(value?: string) {
  if (!value) return "";
  const compact = value.toUpperCase().replace(/\s+/g, "").trim();
  const match = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return match ? `${match[1]} ${match[2]}` : value.toUpperCase().trim();
}

function addressWithPostcode(address: string | undefined, postcode: string) {
  const current = (address || "").trim();
  const formatted = formatPostcode(postcode);
  if (!formatted) return current;
  return postcodePattern.test(current)
    ? current.replace(postcodePattern, formatted)
    : [current, formatted].filter(Boolean).join(", ");
}

function filteredPlannerNotes(value?: string) {
  if (!value) return "";
  const exclude = /^(run type|planner run|reconciliation|source|capacity)\s*:/i;
  return value.split("|").map(part => part.trim()).filter(part => part && !exclude.test(part)).join(" | ");
}

function firstPlannedTime(load: Load) {
  return [...(load.stops || [])].sort((left, right) => left.sequence - right.sequence).find(stop => stop.plannedArrivalUtc)?.plannedArrivalUtc;
}

function buildDriverText(load: Load, dispatch: LoadDispatch) {
  const plannerNotes = filteredPlannerNotes(load.plannerNotes);
  const runLabel = displayRunReference(load.reference, load.plannerNotes, firstPlannedTime(load));
  const loadLine = load.palletSpacesUsed != null
    ? `Load: ${load.palletSpacesUsed}${load.totalPalletSpaces ? ` / ${load.totalPalletSpaces}` : ""} ${load.capacityType || "pallet spaces"}`
    : "";
  const header = [
    `SLH ${runLabel}`,
    dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : "Driver: Unallocated",
    dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registration}` : "Vehicle: Unallocated",
    dispatch.trailer ? `Trailer: ${dispatch.trailer.trailerNumber}` : "",
    loadLine,
    load.temperatureC != null ? `Temperature: ${load.temperatureC > 0 ? "+" : ""}${load.temperatureC}°C` : "",
    plannerNotes ? `Planner notes: ${plannerNotes}` : "",
  ].filter(Boolean).join("\n");

  const stops = dispatch.stops.map(stop => {
    const order = stop.order;
    return [
      `${stop.sequence}. ${stop.name}`,
      order?.marketName ? `Market: ${order.marketName}${order.stallNumber ? ` · Stall ${order.stallNumber}` : ""}` : "",
      order?.sellerName ? `Seller: ${order.sellerName}` : "",
      stop.address ? `Address: ${stop.address}` : "",
      order?.driverInstructions ? `Notes: ${order.driverInstructions}` : "",
      order?.mapLink ? `Map: ${order.mapLink}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return [header, stops, "Please reply to this message to confirm acceptance"].filter(Boolean).join("\n\n");
}

function editableStops(load: Load, sites: Site[]): EditableStop[] {
  return load.stops.map(stop => {
    const site = matchSite(sites, stop.name);
    return {
      ...stop,
      address: usefulAddress(stop.address) ? stop.address : site?.collectionAddress || stop.address,
      latitude: stop.latitude?.toString() || site?.latitude?.toString() || "",
      longitude: stop.longitude?.toString() || site?.longitude?.toString() || "",
      postcode: postcodeFrom(stop.address) || postcodeFrom(site?.collectionAddress),
    };
  });
}

function RunAllocationCard({ load, vehicles, drivers, trailers, sites, onSaved }: {
  load: Load;
  vehicles: Vehicle[];
  drivers: Driver[];
  trailers: Trailer[];
  sites: Site[];
  onSaved: () => Promise<void>;
}) {
  const token = useAccessToken();
  const [vehicleId, setVehicleId] = useState(load.vehicleId || "");
  const [driverId, setDriverId] = useState(load.driverId || "");
  const [trailerId, setTrailerId] = useState(load.trailerId || "");
  const [capacityType, setCapacityType] = useState<CapacityType>(capacityTypeFromLoad(load.capacityType));
  const [used, setUsed] = useState(load.palletSpacesUsed?.toString() || "0");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [routeOpen, setRouteOpen] = useState(false);
  const [routeSummary, setRouteSummary] = useState<string>();
  const [stops, setStops] = useState<EditableStop[]>(() => editableStops(load, sites));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");

  useEffect(() => {
    setVehicleId(load.vehicleId || "");
    setDriverId(load.driverId || "");
    setTrailerId(load.trailerId || "");
    setCapacityType(capacityTypeFromLoad(load.capacityType));
    setUsed(load.palletSpacesUsed?.toString() || "0");
    setStops(editableStops(load, sites));
  }, [load, sites]);

  const selectedTrailer = trailers.find(item => item.id === trailerId);
  const selectedDriver = drivers.find(item => item.id === driverId);
  const effectiveCapacity = trailerCapacity(selectedTrailer, capacityType) ?? load.totalPalletSpaces;
  const numericUsed = Number(used || 0);
  const utilisation = effectiveCapacity && effectiveCapacity > 0 ? numericUsed / effectiveCapacity * 100 : undefined;
  const runLabel = displayRunReference(load.reference, load.plannerNotes, firstPlannedTime(load));

  const stopPayload = (source: EditableStop[]) => source.map(stop => ({
    orderId: stop.orderId,
    name: stop.name,
    address: addressWithPostcode(stop.address, stop.postcode),
    latitude: stop.latitude.trim() ? Number(stop.latitude) : undefined,
    longitude: stop.longitude.trim() ? Number(stop.longitude) : undefined,
    plannedArrivalUtc: stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).toISOString() : undefined,
  }));

  async function saveAllocation() {
    setSaving(true); setMessage(undefined);
    try {
      const access = await token();
      await api.allocateLoad(load.id, { vehicleId: vehicleId || undefined, driverId: driverId || undefined, trailerId: trailerId || undefined }, access);
      await api.updateLoadUtilisation(load.id, {
        palletSpacesUsed: Number.isFinite(numericUsed) ? numericUsed : undefined,
        totalPalletSpaces: effectiveCapacity,
        capacityType,
        depotSplits: load.depotSplits,
        temperatureC: load.temperatureC,
        plannerNotes: load.plannerNotes,
      }, access);
      await onSaved();
      signalPlanningChange();
      setMessage(`Allocation saved · ${loadTypeLabel(capacityType)} · ${effectiveCapacity ?? "capacity pending"} ${spaceLabel(capacityType)} from trailer matrix.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Allocation could not be saved.");
    } finally { setSaving(false); }
  }

  async function resolveLocations(access: string) {
    const next = stops.map(stop => ({ ...stop }));
    const failed: string[] = [];
    let resolved = 0;
    for (const stop of next) {
      const site = matchSite(sites, stop.name);
      const masterPostcode = postcodeFrom(site?.collectionAddress);
      const stopPostcode = postcodeFrom(stop.postcode) || postcodeFrom(stop.address) || masterPostcode;
      if (stopPostcode) stop.postcode = stopPostcode;

      if (site?.collectionAddress) {
        if (!usefulAddress(stop.address)) stop.address = site.collectionAddress;
        else if (stopPostcode && !postcodeFrom(stop.address)) stop.address = addressWithPostcode(stop.address, stopPostcode);
      } else if (stopPostcode && !postcodeFrom(stop.address)) {
        stop.address = addressWithPostcode(stop.address, stopPostcode);
      }

      if (site?.latitude != null && site.longitude != null) {
        stop.latitude = String(site.latitude); stop.longitude = String(site.longitude);
        resolved++; continue;
      }

      const label = stopSiteName(stop.name);
      const query = site?.collectionAddress || (stopPostcode ? `${stopPostcode}, United Kingdom` : usefulAddress(stop.address) ? stop.address! : `${label}, United Kingdom`);
      try {
        const response = await api.geocode(query, access) as { results?: Array<{ position?: { lat?: number; lon?: number } }> };
        const position = response.results?.[0]?.position;
        if (position?.lat == null || position.lon == null) throw new Error("No point returned");
        stop.latitude = String(position.lat); stop.longitude = String(position.lon);
        resolved++;
      } catch { failed.push(stop.name); }
    }
    setStops(next);
    setMessage(failed.length
      ? `${resolved} stop${resolved === 1 ? "" : "s"} located. Check the Site Master postcode for: ${failed.join(", ")}.`
      : `${resolved} stop${resolved === 1 ? "" : "s"} located from Site Master postcode/address data.`);
    return next;
  }

  async function locateStops() {
    setSaving(true); setMessage(undefined); setRouteSummary(undefined);
    try { await resolveLocations(await token()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The route locations could not be resolved."); }
    finally { setSaving(false); }
  }

  async function saveRoute() {
    setSaving(true); setMessage(undefined);
    try {
      await api.updateLoadStops(load.id, stopPayload(stops), await token());
      await onSaved(); signalPlanningChange(); setMessage("Postcodes and planned ETAs saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The route could not be saved."); }
    finally { setSaving(false); }
  }

  async function calculateRoute() {
    setSaving(true); setMessage(undefined); setRouteSummary(undefined);
    try {
      const access = await token();
      let routeStops = stops;
      if (routeStops.filter(stop => stop.latitude.trim() && stop.longitude.trim()).length < 2) routeStops = await resolveLocations(access);
      if (routeStops.filter(stop => stop.latitude.trim() && stop.longitude.trim()).length < 2)
        throw new Error("At least two stops need a valid postcode or Site Master location before an ETA can be calculated.");

      await api.updateLoadStops(load.id, stopPayload(routeStops), access);
      const result = await api.route(load.id, access) as {
        routes?: Array<{ summary?: { lengthInMeters?: number; travelTimeInSeconds?: number } }>;
        approximate?: boolean;
      };
      const summary = result.routes?.[0]?.summary;
      if (!summary) throw new Error("The route service did not return a route.");
      const minutes = Math.max(1, Math.round((summary.travelTimeInSeconds || 0) / 60));
      const miles = ((summary.lengthInMeters || 0) / 1609.344).toFixed(1);
      const firstPlanned = routeStops.find(stop => stop.plannedArrivalUtc)?.plannedArrivalUtc;
      const firstTime = firstPlanned ? new Date(firstPlanned).getTime() : Number.NaN;
      const baseTime = Number.isFinite(firstTime) && firstTime > Date.now() ? firstTime : Date.now();
      const finalEta = new Date(baseTime + minutes * 60_000).toISOString();
      const withEta = routeStops.map((stop, index) => index === routeStops.length - 1 ? { ...stop, plannedArrivalUtc: finalEta } : stop);
      await api.updateLoadStops(load.id, stopPayload(withEta), access);
      setStops(withEta); await onSaved(); signalPlanningChange();
      setMessage("Route and ETA calculated successfully.");
      setRouteSummary(`${miles} miles · estimated drive time ${Math.floor(minutes / 60)}h ${minutes % 60}m · final-stop ETA saved${result.approximate ? " using the resilient road estimate" : ""}.`);
    } catch (error) { setRouteSummary(error instanceof Error ? error.message : "Route calculation failed."); }
    finally { setSaving(false); }
  }

  async function prepareDriverText(openModal = true) {
    setSaving(true); setMessage(undefined);
    try {
      const text = buildDriverText(load, await api.dispatch(load.id, await token()));
      setPreviewText(text); if (openModal) setPreviewOpen(true); return text;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The driver text could not be prepared."); return undefined;
    } finally { setSaving(false); }
  }

  async function copyDriverText() {
    const text = previewText || await prepareDriverText(false);
    if (!text) return;
    await navigator.clipboard.writeText(text); setMessage("Driver text copied.");
  }

  async function sendDriverText() {
    const text = previewText || await prepareDriverText(false);
    if (!text) return;
    setSaving(true); setMessage(undefined);
    try {
      const access = await token();
      const response = await fetch(`/tms-api/api/v1/loads/${encodeURIComponent(load.id)}/driver-message/sms`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
        body: JSON.stringify({ message: text }),
      });
      if (!response.ok) {
        const body = await response.text();
        let detail = body;
        try { detail = (JSON.parse(body) as { message?: string }).message || body; } catch { /* keep response body */ }
        throw new Error(detail || `SMS failed (${response.status}).`);
      }
      const receipt = await response.json() as { provider?: string; mobileSuffix?: string };
      await onSaved(); setPreviewOpen(false);
      setMessage(`${receipt.provider || "SMS provider"} accepted the driver text${receipt.mobileSuffix ? ` for the mobile ending ${receipt.mobileSuffix}` : ""}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The driver SMS could not be sent."); }
    finally { setSaving(false); }
  }

  function updateStop(index: number, field: "address" | "plannedArrivalUtc", value: string) {
    setStops(current => current.map((stop, stopIndex) => {
      if (stopIndex !== index) return stop;
      return field === "address" ? { ...stop, address: value, latitude: "", longitude: "" } : { ...stop, plannedArrivalUtc: value };
    }));
  }

  function updatePostcode(index: number, value: string) {
    setStops(current => current.map((stop, stopIndex) => stopIndex === index
      ? { ...stop, postcode: value.toUpperCase(), latitude: "", longitude: "" }
      : stop));
  }

  return (
    <article className="order-card allocation-card">
      <div className="title-row">
        <div><strong>{runLabel}</strong><small>{load.stops.length} stop{load.stops.length === 1 ? "" : "s"} · {load.stops.map(stop => stop.name).join(" → ") || "Stops pending"}</small></div>
        <span className={utilisation != null && utilisation > 100 ? "capacity-warning" : ""}>
          {numericUsed} / {effectiveCapacity ?? "—"} {spaceLabel(capacityType)} · {loadTypeLabel(capacityType)}{utilisation != null ? ` · ${utilisation.toFixed(1)}%` : ""}
        </span>
      </div>

      <div className="allocation-fields">
        <select value={vehicleId} onChange={event => setVehicleId(event.target.value)}><option value="">Vehicle</option>{vehicles.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.registration}</option>)}</select>
        <select value={driverId} onChange={event => setDriverId(event.target.value)}><option value="">Driver</option>{drivers.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>
        <select value={trailerId} onChange={event => setTrailerId(event.target.value)}><option value="">Trailer</option>{trailers.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.trailerNumber} · Std {item.standardCapacity ?? "—"} / Euro {item.euroCapacity ?? "—"}</option>)}</select>
        <select value={capacityType} onChange={event => setCapacityType(event.target.value as CapacityType)}><option>Standard pallets</option><option>Euro pallets</option><option>Trays</option><option>Trolleys</option><option>Mixed load</option></select>
        <label>Floor spaces used<input type="number" min="0" step="1" value={used} onChange={event => setUsed(event.target.value)} /></label>
        <button className="primary" type="button" onClick={() => void saveAllocation()} disabled={saving}>{saving ? "Saving…" : "Save allocation & capacity"}</button>
      </div>

      <div className="run-card-actions">
        <button type="button" onClick={() => setRouteOpen(value => !value)}>{routeOpen ? "Hide route & ETA" : "Route & ETA"}</button>
        <button type="button" onClick={() => void prepareDriverText(true)} disabled={saving}>Preview text</button>
        <button type="button" onClick={() => void copyDriverText()} disabled={saving}>Copy text</button>
        <button className="primary" type="button" onClick={() => void sendDriverText()} disabled={saving || !driverId || !vehicleId}>Send driver SMS</button>
      </div>

      {routeOpen && <div className="run-route-editor">
        <p className="hint">Postcode is taken from Site Master where available. Map coordinates are resolved automatically in the background and are no longer entered manually.</p>
        {stops.map((stop, index) => <div className="run-route-stop" key={stop.id || index}>
          <strong>{index + 1}. {stop.name}</strong>
          <input placeholder="Address" value={stop.address || ""} onChange={event => updateStop(index, "address", event.target.value)} />
          <input placeholder="Postcode" autoCapitalize="characters" value={stop.postcode} onChange={event => updatePostcode(index, event.target.value)} />
          <input type="datetime-local" value={stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).toISOString().slice(0, 16) : ""} onChange={event => updateStop(index, "plannedArrivalUtc", event.target.value)} />
        </div>)}
        <div className="run-route-actions">
          <button type="button" onClick={() => void locateStops()} disabled={saving}>Resolve postcodes</button>
          <button type="button" onClick={() => void saveRoute()} disabled={saving}>Save route & ETA</button>
          <button className="primary" type="button" onClick={() => void calculateRoute()} disabled={saving}>Calculate route & ETA</button>
        </div>
        {routeSummary && <p className="run-route-summary">{routeSummary}</p>}
      </div>}

      {selectedTrailer ? <p className="hint">Trailer matrix: {selectedTrailer.trailerNumber} · Standard {selectedTrailer.standardCapacity ?? "not set"} · Euro {selectedTrailer.euroCapacity ?? "not set"}.</p> : <p className="hint">Select the trailer to apply its capacity matrix.</p>}
      {selectedDriver && <p className="hint">Driver text recipient: {selectedDriver.displayName} · {selectedDriver.mobileNumber || "mobile number needs approval in Master Data"}</p>}
      {message && <p className="notice inline-notice run-location-warning">{message}</p>}

      {previewOpen && <div className="run-text-modal-backdrop" onClick={() => setPreviewOpen(false)}>
        <div className="run-text-modal" role="dialog" aria-modal="true" aria-label={`Driver text preview for ${runLabel}`} onClick={event => event.stopPropagation()}>
          <div className="title-row"><div><p className="eyebrow">Driver text preview</p><h2>{runLabel}</h2></div><button type="button" onClick={() => setPreviewOpen(false)}>Close</button></div>
          <textarea readOnly value={previewText} />
          <div className="run-text-modal-actions"><button type="button" onClick={() => void copyDriverText()}>Copy text</button><button className="primary" type="button" onClick={() => void sendDriverText()} disabled={saving || !driverId || !vehicleId}>Send driver SMS</button></div>
        </div>
      </div>}
    </article>
  );
}

export function RunsCapacityAllocation() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const loads = useApi(useCallback(async () => api.loads(date, await token()), [date, token]));
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const trailers = useApi(useCallback(async () => api.trailers(await token()), [token]));
  const sites = useApi(useCallback(async () => api.sites(await token()), [token]));
  const rows = loads.data || [];

  const refreshAll = useCallback(async () => {
    await Promise.all([loads.refresh(), vehicles.refresh(), drivers.refresh(), trailers.refresh(), sites.refresh()]);
  }, [drivers.refresh, loads.refresh, sites.refresh, trailers.refresh, vehicles.refresh]);

  useEffect(() => subscribePlanningChanges(() => void refreshAll()), [refreshAll]);

  const error = loads.error || vehicles.error || drivers.error || trailers.error || sites.error;
  return <section>
    <div className="title-row"><div><p className="eyebrow">Run allocation</p><h2>Driver, vehicle, trailer & load capacity</h2><p className="intro">Capacity remains visible on the run card. Driver text is kept operational and concise.</p></div><button type="button" onClick={() => void refreshAll()}>Refresh allocation</button></div>
    <div className="planner-toolbar"><label>Plan date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{rows.length} run{rows.length === 1 ? "" : "s"}</span></div>
    {error && <p className="notice inline-notice">{error}</p>}
    {!error && !rows.length && <div className="state">No runs are available for this planning date.</div>}
    <div className="allocation-load-list">{rows.map(load => <RunAllocationCard key={load.id} load={load} vehicles={vehicles.data || []} drivers={drivers.data || []} trailers={trailers.data || []} sites={sites.data || []} onSaved={refreshAll} />)}</div>
  </section>;
}
