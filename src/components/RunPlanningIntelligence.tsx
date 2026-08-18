import { useCallback, useEffect, useMemo, useState } from "react";
import { request, type Load } from "../lib/api";
import { useAccessToken } from "../lib/auth";

type DriverSuggestion = {
  id: string; displayName: string; employeeNumber: string; tachoName?: string;
  dailyRemainingMinutes?: number; weeklyRemainingMinutes?: number; weeklyWorkRemainingMinutes?: number;
  tachoVehicle?: string; previousRun?: string; previousDate?: string; previousEnd?: string;
  estimatedRepositionMiles?: number; projectedShiftMinutes?: number; projectedShiftRisk?: "Green" | "Amber" | "Red" | "Unknown";
  score: number; shiftRisk: "Green" | "Amber" | "Red" | "Unknown"; reason: string;
};
type VehicleSuggestion = {
  id: string; registration: string; fleetNumber?: string; abbreviation?: string; liveUpdatedAtUtc?: string;
  isMoving?: boolean; lastKnownStatus?: string; currentDriver?: string; previousRun?: string; previousEnd?: string;
  estimatedEmptyMiles?: number; score: number; reason: string;
};
type Intelligence = {
  id: string; reference: string; planningDate: string;
  firstStop?: { id: string; name: string; plannedArrivalUtc?: string };
  lastStop?: { id: string; name: string; plannedArrivalUtc?: string };
  projectedShiftMinutes?: number; projectedShiftRisk?: "Green" | "Amber" | "Red" | "Unknown"; walkroundMinutes?: number;
  nightOutRequired?: boolean;
  driverSuggestions: DriverSuggestion[];
  vehicleSuggestions: VehicleSuggestion[];
  generatedAtUtc: string;
};

const minutes = (value?: number) => value == null ? "Not returned" : `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
const riskSymbol = (risk?: string) => risk === "Red" ? "⚠" : risk === "Amber" ? "△" : risk === "Green" ? "✓" : "?";

export function RunPlanningIntelligence({ load, onChanged }: { load: Load; onChanged?: () => void | Promise<void> }) {
  const token = useAccessToken();
  const [data, setData] = useState<Intelligence>();
  const [driverQuery, setDriverQuery] = useState("");
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [driverId, setDriverId] = useState(load.driverId || "");
  const [vehicleId, setVehicleId] = useState(load.vehicleId || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setData(await request<Intelligence>(`/api/v1/planning-intelligence/loads/${load.id}`, await token(), undefined, 40000));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Planning intelligence could not load.");
    }
  }, [load.id, token]);

  useEffect(() => {
    setDriverId(load.driverId || "");
    setVehicleId(load.vehicleId || "");
    void refresh();
  }, [load.driverId, load.vehicleId, refresh]);

  const drivers = useMemo(() => {
    const q = driverQuery.trim().toLowerCase();
    return (data?.driverSuggestions || []).filter(x => !q || `${x.displayName} ${x.employeeNumber} ${x.tachoName || ""}`.toLowerCase().includes(q));
  }, [data, driverQuery]);
  const vehicles = useMemo(() => {
    const q = vehicleQuery.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return (data?.vehicleSuggestions || []).filter(x => !q || `${x.registration}${x.abbreviation || ""}${x.fleetNumber || ""}`.replace(/[^a-z0-9]/gi, "").toLowerCase().includes(q));
  }, [data, vehicleQuery]);
  const chosenDriver = data?.driverSuggestions.find(x => x.id === driverId);
  const chosenVehicle = data?.vehicleSuggestions.find(x => x.id === vehicleId);

  async function allocate() {
    setBusy(true); setMessage(undefined);
    try {
      const access = await token();
      await request(`/api/v1/loads/${load.id}/allocation`, access, {
        method: "PUT",
        body: JSON.stringify({ driverId: driverId || null, vehicleId: vehicleId || null, trailerId: load.trailerId || null }),
      });
      if (chosenVehicle?.estimatedEmptyMiles != null) {
        await request(`/api/v1/loads/${load.id}/commercial`, access, {
          method: "PUT",
          body: JSON.stringify({ emptyMiles: chosenVehicle.estimatedEmptyMiles }),
        });
      }
      setMessage(chosenVehicle?.estimatedEmptyMiles != null
        ? `Allocation saved. Empty miles set to ${chosenVehicle.estimatedEmptyMiles.toFixed(1)} from the best available DOT / previous-job position.`
        : "Driver and vehicle allocation saved. Empty miles will populate once a positioning point is available.");
      await refresh();
      await onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Allocation could not be saved."); }
    finally { setBusy(false); }
  }

  async function setNightOut(required: boolean) {
    setBusy(true); setMessage(undefined);
    try {
      await request(`/api/v1/planning-intelligence/loads/${load.id}/night-out`, await token(), { method: "PUT", body: JSON.stringify({ required }) });
      setData(current => current ? { ...current, nightOutRequired: required } : current);
      setMessage(required ? "Night out recorded against this run and driver." : "Run marked as no night out.");
      await onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Night-out status could not be saved."); }
    finally { setBusy(false); }
  }

  return <section className="run-intelligence-panel" style={{ marginTop: 12, padding: 12, border: "1px solid #d7e2e7", borderRadius: 10, background: "#fff" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
      <div><p className="eyebrow">Planning intelligence</p><h3 style={{ margin: 0 }}>{load.reference}</h3><small>{data?.firstStop?.name ? `First stop: ${data.firstStop.name}` : "First stop location not yet mapped"}</small></div>
      <button type="button" onClick={() => void refresh()} disabled={busy}>Refresh suggestions</button>
    </div>

    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "#f4f8fa" }}>
      <strong>{riskSymbol(data?.projectedShiftRisk)} Projected shift: {minutes(data?.projectedShiftMinutes)}</strong>
      <div><small>{data?.projectedShiftMinutes == null ? "Add planned stop times to calculate the full run span." : `Includes the ${data?.walkroundMinutes || 15}-minute walkround. ${data?.projectedShiftRisk === "Red" ? "Long shift risk: planner review required." : data?.projectedShiftRisk === "Amber" ? "Long shift: review driver availability before dispatch." : "Planned span is within the standard planning threshold."}`}</small></div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginTop: 12 }}>
      <div>
        <label><strong>Driver</strong><input value={driverQuery} onChange={e => setDriverQuery(e.target.value)} placeholder="Start typing driver name…" style={{ width: "100%" }} /></label>
        <div style={{ maxHeight: 250, overflow: "auto", marginTop: 6 }}>
          {drivers.slice(0, 8).map(item => <button key={item.id} type="button" onClick={() => { setDriverId(item.id); setDriverQuery(item.displayName); }} style={{ width: "100%", textAlign: "left", marginBottom: 5, border: driverId === item.id ? "2px solid #0b5f78" : undefined }}>
            <strong>{riskSymbol(item.shiftRisk)} {item.displayName}</strong>{item.tachoVehicle ? ` · Tacho ${item.tachoVehicle}` : ""}<br />
            <small>Daily driving {minutes(item.dailyRemainingMinutes)} · Weekly driving {minutes(item.weeklyRemainingMinutes)}</small><br />
            <small>Weekly work {minutes(item.weeklyWorkRemainingMinutes)} · Combined risk <b>{item.shiftRisk}</b></small><br />
            <small>{item.reason}</small>
          </button>)}
        </div>
      </div>

      <div>
        <label><strong>Vehicle</strong><input value={vehicleQuery} onChange={e => setVehicleQuery(e.target.value)} placeholder="Type reg or last 3…" style={{ width: "100%" }} /></label>
        <div style={{ maxHeight: 250, overflow: "auto", marginTop: 6 }}>
          {vehicles.slice(0, 8).map(item => <button key={item.id} type="button" onClick={() => { setVehicleId(item.id); setVehicleQuery(item.registration); }} style={{ width: "100%", textAlign: "left", marginBottom: 5, border: vehicleId === item.id ? "2px solid #0b5f78" : undefined }}>
            <strong>{item.registration}</strong>{item.currentDriver ? ` · Current Tacho driver ${item.currentDriver}` : ""}<br />
            <small>{item.estimatedEmptyMiles == null ? "Empty miles not yet calculable" : `Estimated empty miles ${item.estimatedEmptyMiles.toFixed(1)}`}</small><br />
            <small>{item.reason}</small>
          </button>)}
        </div>
      </div>
    </div>

    {(chosenDriver || chosenVehicle) && <div style={{ marginTop: 10, padding: 9, background: "#f4f8fa", borderRadius: 7 }}>
      {chosenDriver && <div><strong>{riskSymbol(chosenDriver.shiftRisk)} {chosenDriver.displayName}</strong> · daily {minutes(chosenDriver.dailyRemainingMinutes)} · weekly {minutes(chosenDriver.weeklyRemainingMinutes)} · risk {chosenDriver.shiftRisk}</div>}
      {chosenVehicle && <div><strong>{chosenVehicle.registration}</strong>{chosenVehicle.estimatedEmptyMiles != null ? ` · ${chosenVehicle.estimatedEmptyMiles.toFixed(1)} estimated empty miles to first job` : ""}</div>}
    </div>}

    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
      <button type="button" className="primary" disabled={busy || !driverId || !vehicleId} onClick={() => void allocate()}>Save allocation</button>
      <span style={{ marginLeft: 8 }}><strong>Night out required?</strong></span>
      <button type="button" disabled={busy} className={data?.nightOutRequired === true ? "primary" : ""} onClick={() => void setNightOut(true)}>Yes</button>
      <button type="button" disabled={busy} className={data?.nightOutRequired === false ? "primary" : ""} onClick={() => void setNightOut(false)}>No</button>
      {data?.nightOutRequired == null && <small>Planner confirmation required</small>}
    </div>
    {message && <p className="notice inline-notice" style={{ marginTop: 8 }}>{message}</p>}
  </section>;
}
