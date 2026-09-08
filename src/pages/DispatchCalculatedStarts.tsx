import { useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange } from "../lib/planningEvents";

export const dispatchStartsCalculatedEvent = "slh:dispatch-starts-calculated";

export type StartSuggestion = {
  loadId: string;
  runReference?: string;
  driverName?: string;
  existingStartUtc?: string;
  existingStartSource?: string;
  legalRestCompleteUtc?: string;
  suggestedStartUtc?: string;
  walkaroundMinutes?: number;
  origin?: string;
  travelMinutes?: number;
  firstCollectionEtaUtc?: string;
  firstCollection?: string;
  latestOnSite?: string;
  restType?: string;
  explanation?: string;
};
type StartResponse = { rows?: StartSuggestion[] };
type DispatchLoad = { id: string; driverId?: string; vehicleId?: string };
type DispatchDriver = { driverId: string; assignedLoadId?: string; onLeave: boolean };
type Workbench = { loads: DispatchLoad[]; drivers: DispatchDriver[] };
type DriverStatus = { driverId: string; availabilityStatus?: "Available" | "Unavailable" | "Unverified"; weeklyRestStatus?: string };

function currentDispatchDate() {
  const query = new URLSearchParams(window.location.search).get("date");
  if (query) return query;
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function publishStarts(date: string, rows: StartSuggestion[]) {
  window.dispatchEvent(new CustomEvent(dispatchStartsCalculatedEvent, { detail: { date, rows } }));
}

export function DispatchCalculatedStarts() {
  const token = useAccessToken();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function calculate() {
    setBusy(true);
    setMessage(undefined);
    try {
      const date = currentDispatchDate();
      const access = await token();
      const [starts, workbench, statusResponse] = await Promise.all([
        request<StartResponse>(`/api/v1/planner-starts?date=${encodeURIComponent(date)}`, access),
        request<Workbench>(`/api/v1/driver-dispatch?date=${encodeURIComponent(date)}`, access, undefined, 90000),
        request<{ drivers: DriverStatus[] }>(`/api/v1/driver-dispatch-status?date=${encodeURIComponent(date)}`, access, undefined, 90000),
      ]);

      const rows = starts.rows || [];
      publishStarts(date, rows);

      const statusByDriver = new Map(statusResponse.drivers.map((row) => [row.driverId, row]));
      const driverByLoad = new Map(workbench.drivers.filter((driver) => driver.assignedLoadId).map((driver) => [driver.assignedLoadId!, driver]));
      const loadById = new Map(workbench.loads.map((load) => [load.id, load]));

      const eligible = rows.filter((row) => {
        if (!row.suggestedStartUtc) return false;
        const load = loadById.get(row.loadId);
        if (!load?.driverId || !load.vehicleId) return false;
        const driver = driverByLoad.get(row.loadId);
        if (!driver || driver.onLeave) return false;
        const status = statusByDriver.get(driver.driverId);
        return status?.availabilityStatus !== "Unavailable" && status?.weeklyRestStatus !== "Overdue";
      });

      if (!eligible.length) {
        setMessage("No allocated, available runs have a legal calculated start yet. Hover the Could Start column for the reason.");
        return;
      }

      await Promise.all(eligible.map((row) => request(`/api/v1/planner-starts/${encodeURIComponent(row.loadId)}/apply`, access, { method: "PUT" })));
      signalPlanningChange();
      publishStarts(date, rows);
      setMessage(`${eligible.length} allocated run${eligible.length === 1 ? "" : "s"} updated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Start times could not be calculated.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="dispatch-calculated-starts">
    <button className="primary" type="button" onClick={() => void calculate()} disabled={busy} title="Calculate starts after allocation using Sage HR availability, TachoMaster duty/rest, DOT tracking, previous finish location, vehicle availability and route time to first collection.">
      {busy ? "Calculating Starts…" : "Calculate Starts"}
    </button>
    {message && <span className="hint" title={message}>{message}</span>}
  </div>;
}