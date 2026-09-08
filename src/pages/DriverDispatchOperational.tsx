import { type MouseEvent, useEffect, useState } from "react";
import { getDriverDispatchRoute, getRunDispatch } from "../api/runs";
import { request, type LoadDispatch } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { startVisiblePolling } from "../lib/visiblePolling";
import { DriverDispatch } from "./DriverDispatch";

type WorkbenchDriver = { driverId: string; displayName: string; assignedLoadId?: string };
type WorkbenchLoad = { id: string; reference: string; rawReference?: string; southbound?: boolean; plannedStartUtc?: string; stops?: Array<{ sequence: number; plannedArrivalUtc?: string }> };
type Workbench = { drivers: WorkbenchDriver[]; loads: WorkbenchLoad[] };
type DispatchReadiness = { canDispatch: boolean; explanation?: string; structuralReadiness?: { classification: "Recommended" | "Unverified" | "Blocked"; requiresAcknowledgement: boolean; checks: Array<{ passed: boolean; message: string }> } };
type DialogState = { driverName: string; load?: WorkbenchLoad; text: string; loading: boolean; error?: string };

function localTime(value?: string) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
function firstPlannedTime(load: WorkbenchLoad) { return [...(load.stops || [])].sort((a, b) => a.sequence - b.sequence).find(stop => stop.plannedArrivalUtc)?.plannedArrivalUtc || load.plannedStartUtc; }
function routeMinutes(route: Record<string, unknown>) { const routes = route.routes as Array<{ summary?: { travelTimeInSeconds?: number } }> | undefined; const seconds = routes?.[0]?.summary?.travelTimeInSeconds; return typeof seconds === "number" && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : undefined; }
function buildDriverText(load: WorkbenchLoad, dispatch: LoadDispatch) {
  const startTime = localTime(firstPlannedTime(load));
  const lines = [`SLH ${load.southbound ? "Southbound " : ""}${load.reference}`, dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : "", startTime ? `Planned start: ${startTime}` : "", dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registration}` : "", dispatch.trailer ? `Trailer: ${dispatch.trailer.trailerNumber}` : "", "", ...dispatch.stops.flatMap(stop => [`${stop.sequence}. ${stop.name}`, stop.address ? `Address: ${stop.address}` : "", stop.order?.reference ? `Ref: ${stop.order.reference}` : "", stop.order?.marketName ? `Market: ${stop.order.marketName}${stop.order.stallNumber ? ` · Stall ${stop.order.stallNumber}` : ""}` : "", stop.order?.driverInstructions ? `Notes: ${stop.order.driverInstructions}` : "", stop.order?.mapLink ? `Map: ${stop.order.mapLink}` : "", ""]), "Please reply to confirm receipt."];
  return lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n").trim();
}

export function DriverDispatchOperational() {
  const token = useAccessToken();
  const [dialog, setDialog] = useState<DialogState>();
  const [sending, setSending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => startVisiblePolling(() => setRefreshKey(value => value + 1), 60_000), []);

  async function openDispatchPreview(driverName: string) {
    setDialog({ driverName, text: "Preparing driver text preview…", loading: true });
    try {
      const access = await token();
      const date = new URLSearchParams(window.location.search).get("date") || new Date().toISOString().slice(0, 10);
      const workbench = await request<Workbench>(`/api/v1/driver-dispatch?date=${encodeURIComponent(date)}`, access, undefined, 90000);
      const driver = workbench.drivers.find(item => item.displayName.trim().toLowerCase() === driverName.trim().toLowerCase());
      if (!driver?.assignedLoadId) throw new Error(`${driverName} does not currently have an allocated run.`);
      const load = workbench.loads.find(item => item.id === driver.assignedLoadId);
      if (!load) throw new Error("The allocated run could not be found in Driver Dispatch.");
      const dispatch = await getRunDispatch(load.id, access);
      setDialog({ driverName, load, text: buildDriverText(load, dispatch), loading: false });
    } catch (error) {
      setDialog(current => current ? { ...current, loading: false, error: error instanceof Error ? error.message : "The dispatch text preview could not be prepared." } : current);
    }
  }

  function captureDispatchClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const button = target.closest("button");
    if (!button) return;
    const label = (button.textContent || "").trim().toLowerCase();
    if (label !== "dispatch" && label !== "dispatch to text") return;
    const row = button.closest("tr");
    const driverName = row?.querySelector("td:first-child strong")?.textContent?.trim();
    if (!driverName) return;
    event.preventDefault(); event.stopPropagation(); void openDispatchPreview(driverName);
  }

  async function sendDispatch() {
    if (!dialog?.load || !dialog.text.trim()) return;
    setSending(true); setDialog(current => current ? { ...current, error: undefined } : current);
    try {
      const access = await token();
      const route = await getDriverDispatchRoute(dialog.load.id, access);
      const minutes = routeMinutes(route);
      if (!minutes) throw new Error("The route could not be calculated. Dispatch has not been sent.");
      let acknowledged = false;
      let readiness = await request<DispatchReadiness>(`/api/v1/loads/${encodeURIComponent(dialog.load.id)}/dispatch-readiness`, access, { method: "POST", body: JSON.stringify({ routeDrivingMinutes: minutes, acknowledgeUnverified: false }) }, 90000);
      if (!readiness.canDispatch && readiness.structuralReadiness?.classification === "Unverified" && readiness.structuralReadiness.requiresAcknowledgement) {
        const warnings = readiness.structuralReadiness.checks.filter(check => !check.passed).map(check => `• ${check.message}`).join("\n");
        if (!window.confirm(`Pre-dispatch warnings:\n\n${warnings}\n\nAcknowledge and send this dispatch text?`)) return;
        acknowledged = true;
        readiness = await request<DispatchReadiness>(`/api/v1/loads/${encodeURIComponent(dialog.load.id)}/dispatch-readiness`, access, { method: "POST", body: JSON.stringify({ routeDrivingMinutes: minutes, acknowledgeUnverified: true }) }, 90000);
      }
      if (!readiness.canDispatch) throw new Error(readiness.explanation || "Dispatch readiness did not pass. The text has not been sent.");
      await request(`/api/v1/loads/${encodeURIComponent(dialog.load.id)}/driver-message/sms`, access, { method: "POST", body: JSON.stringify({ message: dialog.text, dispatch: true, routeDrivingMinutes: minutes, acknowledgeUnverified: acknowledged }) }, 90000);
      setDialog(undefined);
      setRefreshKey(value => value + 1);
    } catch (error) { setDialog(current => current ? { ...current, error: error instanceof Error ? error.message : "Driver text could not be sent." } : current); }
    finally { setSending(false); }
  }

  return <div onClickCapture={captureDispatchClick}>
    <DriverDispatch key={refreshKey} />
    {dialog && <div className="dispatch-modal-backdrop" role="dialog" aria-modal="true" aria-label="Dispatch text preview"><div className="dispatch-modal dispatch-text-first-modal"><div className="title-row"><div><p className="eyebrow">Dispatch text preview</p><h2>{dialog.load?.reference || dialog.driverName}</h2><p className="hint">Review or edit the exact driver text. Route, Tacho and dispatch-readiness checks run when you press Send Dispatch.</p></div><button type="button" onClick={() => setDialog(undefined)} disabled={sending}>Close</button></div><textarea rows={14} value={dialog.text} disabled={dialog.loading || sending} onChange={event => setDialog(current => current ? { ...current, text: event.target.value } : current)} />{dialog.loading && <p className="hint">Loading the allocated run, driver, vehicle, trailer and stop details…</p>}{dialog.error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{dialog.error}</p>}<div className="dispatch-modal-actions"><button type="button" onClick={() => setDialog(undefined)} disabled={sending}>Cancel</button><button className="primary" type="button" onClick={() => void sendDispatch()} disabled={dialog.loading || sending || !dialog.load || !dialog.text.trim()}>{sending ? "Sending…" : "SEND DISPATCH"}</button></div></div></div>}
  </div>;
}
