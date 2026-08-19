import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useApi } from "../lib/useApi";
import "../runs-capacity-allocation.css";

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

type CapacityType = "Standard pallets" | "Euro pallets" | "Trays" | "Trolleys" | "Mixed load";
type EditableStop = Omit<Load["stops"][number], "latitude" | "longitude"> & {
  latitude: string;
  longitude: string;
};

function loadTypeLabel(type?: string) {
  switch ((type || "").toLowerCase()) {
    case "euro pallets": return "Euro pallet load";
    case "trays": return "Tray load";
    case "trolleys": return "Trolley load";
    case "mixed load": return "Mixed-unit load";
    default: return "Standard pallet load";
  }
}

function spaceLabel(type?: string) {
  return (type || "").toLowerCase() === "euro pallets" ? "Euro spaces" : "floor spaces";
}

function trailerCapacity(trailer: Trailer | undefined, type: string) {
  if (!trailer) return undefined;
  if (type.toLowerCase() === "euro pallets") return trailer.euroCapacity ?? trailer.standardCapacity;
  return trailer.standardCapacity ?? trailer.euroCapacity;
}

function capacityTypeFromLoad(value?: string): CapacityType {
  const allowed: CapacityType[] = ["Standard pallets", "Euro pallets", "Trays", "Trolleys", "Mixed load"];
  return allowed.includes(value as CapacityType) ? value as CapacityType : "Mixed load";
}

function normalise(value?: string) {
  return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function stopSiteName(value: string) {
  return value
    .replace(/^\s*(collect|deliver)\s*[·:\-]\s*/i, "")
    .replace(/\s*→.*$/, "")
    .trim();
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
  if (!value) return false;
  return /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(value) || /\d+\s+[A-Za-z]/.test(value);
}

function filteredPlannerNotes(value?: string) {
  if (!value) return "";
  const exclude = /^(run type|planner run|reconciliation|source|capacity)\s*:/i;
  return value
    .split("|")
    .map(part => part.trim())
    .filter(part => part && !exclude.test(part))
    .join(" | ");
}

function buildDriverText(load: Load, dispatch: LoadDispatch) {
  const plannerNotes = filteredPlannerNotes(load.plannerNotes);
  const header = [
    `SLH run ${dispatch.reference}`,
    dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : "Driver: Unallocated",
    dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registration}` : "Vehicle: Unallocated",
    dispatch.trailer ? `Trailer: ${dispatch.trailer.trailerNumber}` : "",
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

  return [header, stops, "Please reply to this message to confirm acceptance"]
    .filter(Boolean)
    .join("\n\n");
}

function editableStops(load: Load): EditableStop[] {
  return load.stops.map(stop => ({
    ...stop,
    latitude: stop.latitude?.toString() || "",
    longitude: stop.longitude?.toString() || "",
  }));
}

function RunAllocationCard({
  load,
  vehicles,
  drivers,
  trailers,
  sites,
  onSaved,
}: {
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
  const [stops, setStops] = useState<EditableStop[]>(() => editableStops(load));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");

  useEffect(() => {
    setVehicleId(load.vehicleId || "");
    setDriverId(load.driverId || "");
    setTrailerId(load.trailerId || "");
    setCapacityType(capacityTypeFromLoad(load.capacityType));
    setUsed(load.palletSpacesUsed?.toString() || "0");
    setStops(editableStops(load));
  }, [load]);

  const selectedTrailer = trailers.find(item => item.id === trailerId);
  const selectedDriver = drivers.find(item => item.id === driverId);
  const matrixCapacity = trailerCapacity(selectedTrailer, capacityType);
  const effectiveCapacity = matrixCapacity ?? load.totalPalletSpaces;
  const numericUsed = Number(used || 0);
  const utilisation = effectiveCapacity && effectiveCapacity > 0 ? (numericUsed / effectiveCapacity) * 100 : undefined;

  function stopPayload(source: EditableStop[]) {
    return source.map(stop => ({
      orderId: stop.orderId,
      name: stop.name,
      address: stop.address,
      latitude: stop.latitude.trim() ? Number(stop.latitude) : undefined,
      longitude: stop.longitude.trim() ? Number(stop.longitude) : undefined,
      plannedArrivalUtc: stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).toISOString() : undefined,
    }));
  }

  async function saveAllocation() {
    setSaving(true);
    setMessage(undefined);
    try {
      const access = await token();
      await api.allocateLoad(load.id, {
        vehicleId: vehicleId || undefined,
        driverId: driverId || undefined,
        trailerId: trailerId || undefined,
      }, access);
      await api.updateLoadUtilisation(load.id, {
        palletSpacesUsed: Number.isFinite(numericUsed) ? numericUsed : undefined,
        totalPalletSpaces: effectiveCapacity,
        capacityType,
        depotSplits: load.depotSplits,
        temperatureC: load.temperatureC,
        plannerNotes: load.plannerNotes,
      }, access);
      await onSaved();
      setMessage(`Allocation saved · ${loadTypeLabel(capacityType)} · ${effectiveCapacity ?? "capacity pending"} ${spaceLabel(capacityType)} from trailer matrix.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Allocation could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function resolveLocations(access: string) {
    const next = stops.map(stop => ({ ...stop }));
    const failed: string[] = [];
    let resolved = 0;

    for (let index = 0; index < next.length; index++) {
      const stop = next[index];
      const site = matchSite(sites, stop.name);
      if (site?.latitude != null && site.longitude != null) {
        stop.latitude = String(site.latitude);
        stop.longitude = String(site.longitude);
        if (site.collectionAddress && !usefulAddress(stop.address)) stop.address = site.collectionAddress;
        resolved++;
        continue;
      }

      const label = stopSiteName(stop.name);
      const query = site?.collectionAddress || (usefulAddress(stop.address) ? stop.address! : `${label}, United Kingdom`);
      try {
        const response = await api.geocode(query, access) as { results?: Array<{ position?: { lat?: number; lon?: number } }> };
        const position = response.results?.[0]?.position;
        if (position?.lat == null || position.lon == null) throw new Error("No point returned");
        stop.latitude = String(position.lat);
        stop.longitude = String(position.lon);
        if (site?.collectionAddress && !usefulAddress(stop.address)) stop.address = site.collectionAddress;
        resolved++;
      } catch {
        failed.push(stop.name);
      }
    }

    setStops(next);
    setMessage(failed.length
      ? `${resolved} stop${resolved === 1 ? "" : "s"} located. Could not locate: ${failed.join(", ")}. You can enter those coordinates manually.`
      : `${resolved} stop${resolved === 1 ? "" : "s"} located from Site Master / map search.`);
    return next;
  }

  async function locateStops() {
    setSaving(true);
    setMessage(undefined);
    setRouteSummary(undefined);
    try {
      await resolveLocations(await token());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The route locations could not be resolved.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRoute() {
    setSaving(true);
    setMessage(undefined);
    try {
      await api.updateLoadStops(load.id, stopPayload(stops), await token());
      await onSaved();
      setMessage("Route points and planned ETAs saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The route could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function calculateRoute() {
    setSaving(true);
    setMessage(undefined);
    setRouteSummary(undefined);
    try {
      const access = await token();
      let routeStops = stops;
      let mapped = routeStops.filter(stop => stop.latitude.trim() && stop.longitude.trim()).length;
      if (mapped < 2) {
        routeStops = await resolveLocations(access);
        mapped = routeStops.filter(stop => stop.latitude.trim() && stop.longitude.trim()).length;
      }
      if (mapped < 2) throw new Error("At least two stops need map coordinates before an ETA can be calculated.");

      // Persist the coordinates first because the API route calculation reads the saved run.
      await api.updateLoadStops(load.id, stopPayload(routeStops), access);
      const result = await api.route(load.id, access) as {
        routes?: Array<{ summary?: { lengthInMeters?: number; travelTimeInSeconds?: number } }>;
        approximate?: boolean;
        source?: string;
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
      setStops(withEta);
      await onSaved();
      setRouteSummary(`${miles} miles · estimated drive time ${Math.floor(minutes / 60)}h ${minutes % 60}m · final-stop ETA saved${result.approximate ? " using the resilient road estimate" : ""}.`);
      setMessage("Route and ETA calculated successfully.");
    } catch (error) {
      setRouteSummary(error instanceof Error ? error.message : "Route calculation failed.");
    } finally {
      setSaving(false);
    }
  }

  async function prepareDriverText(openModal = true) {
    setSaving(true);
    setMessage(undefined);
    try {
      const dispatch = await api.dispatch(load.id, await token());
      const text = buildDriverText(load, dispatch);
      setPreviewText(text);
      if (openModal) setPreviewOpen(true);
      return text;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The driver text could not be prepared.");
      return undefined;
    } finally {
      setSaving(false);
    }
  }

  async function copyDriverText() {
    const text = previewText || await prepareDriverText(false);
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setMessage("Driver text copied.");
  }

  async function sendDriverText() {
    const text = previewText || await prepareDriverText(false);
    if (!text) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const access = await token();
      const response = await fetch(`/tms-api/api/v1/loads/${encodeURIComponent(load.id)}/driver-message/sms`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
        },
        body: JSON.stringify({ message: text }),
      });
      if (!response.ok) {
        const body = await response.text();
        try {
          const parsed = JSON.parse(body) as { message?: string };
          throw new Error(parsed.message || body || `SMS failed (${response.status}).`);
        } catch (error) {
          if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
          throw new Error(body || `SMS failed (${response.status}).`);
        }
      }
      const receipt = await response.json() as { provider?: string; mobileSuffix?: string };
      await onSaved();
      setPreviewOpen(false);
      setMessage(`${receipt.provider || "SMS provider"} accepted the driver text${receipt.mobileSuffix ? ` for the mobile ending ${receipt.mobileSuffix}` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The driver SMS could not be sent.");
    } finally {
      setSaving(false);
    }
  }

  function updateStop(index: number, field: "address" | "latitude" | "longitude" | "plannedArrivalUtc", value: string) {
    setStops(current => current.map((stop, stopIndex) => stopIndex === index ? { ...stop, [field]: value } : stop));
  }

  return (
    <article className="order-card allocation-card">
      <div className="title-row">
        <div>
          <strong>{load.reference}</strong>
          <small>{load.stops.length} stop{load.stops.length === 1 ? "" : "s"} · {load.stops.map(stop => stop.name).join(" → ") || "Stops pending"}</small>
        </div>
        <span className={utilisation != null && utilisation > 100 ? "capacity-warning" : ""}>
          {numericUsed} / {effectiveCapacity ?? "—"} {spaceLabel(capacityType)} · {loadTypeLabel(capacityType)}
          {utilisation != null ? ` · ${utilisation.toFixed(1)}%` : ""}
        </span>
      </div>

      <div className="allocation-fields">
        <select value={vehicleId} onChange={event => setVehicleId(event.target.value)}>
          <option value="">Vehicle</option>
          {vehicles.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.registration}</option>)}
        </select>
        <select value={driverId} onChange={event => setDriverId(event.target.value)}>
          <option value="">Driver</option>
          {drivers.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
        </select>
        <select value={trailerId} onChange={event => setTrailerId(event.target.value)}>
          <option value="">Trailer</option>
          {trailers.filter(item => item.active).map(item => (
            <option key={item.id} value={item.id}>{item.trailerNumber} · Std {item.standardCapacity ?? "—"} / Euro {item.euroCapacity ?? "—"}</option>
          ))}
        </select>
        <select value={capacityType} onChange={event => setCapacityType(event.target.value as CapacityType)}>
          <option>Standard pallets</option><option>Euro pallets</option><option>Trays</option><option>Trolleys</option><option>Mixed load</option>
        </select>
        <label>Floor spaces used<input type="number" min="0" step="1" value={used} onChange={event => setUsed(event.target.value)} /></label>
        <button className="primary" type="button" onClick={() => void saveAllocation()} disabled={saving}>{saving ? "Saving…" : "Save allocation & capacity"}</button>
      </div>

      <div className="run-card-actions">
        <button type="button" onClick={() => setRouteOpen(value => !value)}>{routeOpen ? "Hide route & ETA" : "Route & ETA"}</button>
        <button type="button" onClick={() => void prepareDriverText(true)} disabled={saving}>Preview text</button>
        <button type="button" onClick={() => void copyDriverText()} disabled={saving}>Copy text</button>
        <button className="primary" type="button" onClick={() => void sendDriverText()} disabled={saving || !driverId || !vehicleId}>Send driver SMS</button>
      </div>

      {routeOpen && (
        <div className="run-route-editor">
          <p className="hint">Locate uses Site Master first, then map search. Calculate route automatically saves the coordinates before asking the API for the ETA.</p>
          {stops.map((stop, index) => (
            <div className="run-route-stop" key={stop.id || index}>
              <strong>{index + 1}. {stop.name}</strong>
              <input placeholder="Address" value={stop.address || ""} onChange={event => updateStop(index, "address", event.target.value)} />
              <input placeholder="Latitude" inputMode="decimal" value={stop.latitude} onChange={event => updateStop(index, "latitude", event.target.value)} />
              <input placeholder="Longitude" inputMode="decimal" value={stop.longitude} onChange={event => updateStop(index, "longitude", event.target.value)} />
              <input type="datetime-local" value={stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).toISOString().slice(0, 16) : ""} onChange={event => updateStop(index, "plannedArrivalUtc", event.target.value)} />
            </div>
          ))}
          <div className="run-route-actions">
            <button type="button" onClick={() => void locateStops()} disabled={saving}>Locate addresses</button>
            <button type="button" onClick={() => void saveRoute()} disabled={saving}>Save route & ETA</button>
            <button className="primary" type="button" onClick={() => void calculateRoute()} disabled={saving}>Calculate route & ETA</button>
          </div>
          {routeSummary && <p className="run-route-summary">{routeSummary}</p>}
        </div>
      )}

      {selectedTrailer && <p className="hint">Trailer matrix: {selectedTrailer.trailerNumber} · Standard {selectedTrailer.standardCapacity ?? "not set"} · Euro {selectedTrailer.euroCapacity ?? "not set"}. Trays and trolleys retain their load type but use the trailer's physical floor-space capacity unless a specific matrix value is added later.</p>}
      {!selectedTrailer && <p className="hint">Select the trailer to apply its capacity matrix. The TMS will not assume every run is 26 standard pallets.</p>}
      {selectedDriver && <p className="hint">Driver text recipient: {selectedDriver.displayName} · {selectedDriver.mobileNumber || "mobile number needs approval in Master Data"}</p>}
      {message && <p className="notice inline-notice run-location-warning">{message}</p>}

      {previewOpen && (
        <div className="run-text-modal-backdrop" onClick={() => setPreviewOpen(false)}>
          <div className="run-text-modal" role="dialog" aria-modal="true" aria-label={`Driver text preview for ${load.reference}`} onClick={event => event.stopPropagation()}>
            <div className="title-row"><div><p className="eyebrow">Driver text preview</p><h2>{load.reference}</h2></div><button type="button" onClick={() => setPreviewOpen(false)}>Close</button></div>
            <textarea readOnly value={previewText} />
            <div className="run-text-modal-actions">
              <button type="button" onClick={() => void copyDriverText()}>Copy text</button>
              <button className="primary" type="button" onClick={() => void sendDriverText()} disabled={saving || !driverId || !vehicleId}>Send driver SMS</button>
            </div>
          </div>
        </div>
      )}
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
  const rows = useMemo(() => loads.data || [], [loads.data]);

  async function refreshAll() {
    await Promise.all([loads.refresh(), vehicles.refresh(), drivers.refresh(), trailers.refresh(), sites.refresh()]);
  }

  const error = loads.error || vehicles.error || drivers.error || trailers.error || sites.error;
  return (
    <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">Run allocation</p>
          <h2>Driver, vehicle, trailer & load capacity</h2>
          <p className="intro">Capacity remains visible on the run card. Driver texts exclude utilisation and planner-import metadata.</p>
        </div>
        <button type="button" onClick={() => void refreshAll()}>Refresh allocation</button>
      </div>
      <div className="planner-toolbar">
        <label>Plan date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <span>{rows.length} run{rows.length === 1 ? "" : "s"}</span>
      </div>
      {error && <p className="notice inline-notice">{error}</p>}
      {!error && !rows.length && <div className="state">No runs are available for this planning date.</div>}
      <div className="allocation-load-list">
        {rows.map(load => (
          <RunAllocationCard
            key={load.id}
            load={load}
            vehicles={vehicles.data || []}
            drivers={drivers.data || []}
            trailers={trailers.data || []}
            sites={sites.data || []}
            onSaved={loads.refresh}
          />
        ))}
      </div>
    </section>
  );
}
