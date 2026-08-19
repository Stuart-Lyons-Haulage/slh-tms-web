import { useCallback, useMemo, useState } from "react";
import { api, type Driver, type Load, type Trailer, type Vehicle } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

type CapacityType = "Standard pallets" | "Euro pallets" | "Trays" | "Trolleys" | "Mixed load";

function unitLabel(type?: string) {
  switch ((type || "").toLowerCase()) {
    case "euro pallets": return "Euro pallets";
    case "trays": return "trays";
    case "trolleys": return "trolleys";
    case "mixed load": return "mixed units";
    default: return "standard pallets";
  }
}

function trailerCapacity(trailer: Trailer | undefined, type: string) {
  if (!trailer) return undefined;
  if (type.toLowerCase() === "euro pallets") return trailer.euroCapacity ?? trailer.standardCapacity;
  return trailer.standardCapacity ?? trailer.euroCapacity;
}

function RunAllocationCard({
  load,
  vehicles,
  drivers,
  trailers,
  onSaved,
}: {
  load: Load;
  vehicles: Vehicle[];
  drivers: Driver[];
  trailers: Trailer[];
  onSaved: () => Promise<void>;
}) {
  const token = useAccessToken();
  const [vehicleId, setVehicleId] = useState(load.vehicleId || "");
  const [driverId, setDriverId] = useState(load.driverId || "");
  const [trailerId, setTrailerId] = useState(load.trailerId || "");
  const [capacityType, setCapacityType] = useState<CapacityType>((load.capacityType as CapacityType) || "Standard pallets");
  const [used, setUsed] = useState(load.palletSpacesUsed?.toString() || "0");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();

  const selectedTrailer = trailers.find((item) => item.id === trailerId);
  const matrixCapacity = trailerCapacity(selectedTrailer, capacityType);
  const effectiveCapacity = matrixCapacity ?? load.totalPalletSpaces;
  const numericUsed = Number(used || 0);
  const utilisation = effectiveCapacity && effectiveCapacity > 0 ? (numericUsed / effectiveCapacity) * 100 : undefined;

  async function save() {
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
      setMessage(`Allocation saved · ${capacityType} · ${effectiveCapacity ?? "capacity pending"} capacity from trailer matrix.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Allocation could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="order-card allocation-card">
      <div className="title-row">
        <div>
          <strong>{load.reference}</strong>
          <small>{load.stops.length} stop{load.stops.length === 1 ? "" : "s"} · {load.stops.map((stop) => stop.name).join(" → ") || "Stops pending"}</small>
        </div>
        <span className={utilisation != null && utilisation > 100 ? "capacity-warning" : ""}>
          {numericUsed} / {effectiveCapacity ?? "—"} {unitLabel(capacityType)}
          {utilisation != null ? ` · ${utilisation.toFixed(1)}%` : ""}
        </span>
      </div>

      <div className="allocation-fields">
        <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
          <option value="">Vehicle</option>
          {vehicles.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.registration}</option>)}
        </select>
        <select value={driverId} onChange={(event) => setDriverId(event.target.value)}>
          <option value="">Driver</option>
          {drivers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
        </select>
        <select value={trailerId} onChange={(event) => setTrailerId(event.target.value)}>
          <option value="">Trailer</option>
          {trailers.filter((item) => item.active).map((item) => (
            <option key={item.id} value={item.id}>
              {item.trailerNumber} · Std {item.standardCapacity ?? "—"} / Euro {item.euroCapacity ?? "—"}
            </option>
          ))}
        </select>
        <select value={capacityType} onChange={(event) => setCapacityType(event.target.value as CapacityType)}>
          <option>Standard pallets</option>
          <option>Euro pallets</option>
          <option>Trays</option>
          <option>Trolleys</option>
          <option>Mixed load</option>
        </select>
        <label>
          Units / spaces used
          <input type="number" min="0" step="1" value={used} onChange={(event) => setUsed(event.target.value)} />
        </label>
        <button className="primary" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save allocation & capacity"}
        </button>
      </div>

      {selectedTrailer && (
        <p className="hint">
          Trailer matrix: {selectedTrailer.trailerNumber} · Standard {selectedTrailer.standardCapacity ?? "not set"} · Euro {selectedTrailer.euroCapacity ?? "not set"}. The selected load type determines which capacity is used.
        </p>
      )}
      {!selectedTrailer && <p className="hint">Select the trailer to apply its capacity matrix. The TMS will not assume every run is 26 standard pallets.</p>}
      {message && <p className="notice inline-notice">{message}</p>}
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
  const rows = useMemo(() => loads.data || [], [loads.data]);

  async function refreshAll() {
    await Promise.all([loads.refresh(), vehicles.refresh(), drivers.refresh(), trailers.refresh()]);
  }

  const error = loads.error || vehicles.error || drivers.error || trailers.error;
  return (
    <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">Run allocation</p>
          <h2>Driver, vehicle, trailer & load capacity</h2>
          <p className="intro">Capacity comes from the selected trailer matrix and is retained with the run unit type.</p>
        </div>
        <button type="button" onClick={() => void refreshAll()}>Refresh allocation</button>
      </div>
      <div className="planner-toolbar">
        <label>Plan date <input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <span>{rows.length} run{rows.length === 1 ? "" : "s"}</span>
      </div>
      {error && <p className="notice inline-notice">{error}</p>}
      {!error && !rows.length && <div className="state">No runs are available for this planning date.</div>}
      <div className="allocation-load-list">
        {rows.map((load) => (
          <RunAllocationCard
            key={load.id}
            load={load}
            vehicles={vehicles.data || []}
            drivers={drivers.data || []}
            trailers={trailers.data || []}
            onSaved={loads.refresh}
          />
        ))}
      </div>
    </section>
  );
}
