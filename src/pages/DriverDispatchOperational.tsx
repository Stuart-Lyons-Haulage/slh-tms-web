import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BackloadMatchNotifications } from "../components/BackloadMatchNotifications";
import { CustomerLoadPlanActions } from "../components/CustomerLoadPlanActions";
import { DispatchBoard } from "../components/dispatch/DispatchBoard";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { DriverDispatch } from "./DriverDispatch";

type WorkbenchDriver = { driverId: string; employeeNumber?: string; displayName: string };
type Workbench = { drivers: WorkbenchDriver[] };
type OperationalStatus = "No Run" | "Awaiting Dispatch" | "Dispatched" | "Working" | "Completed";
type OperationalDriverStatus = { driverId: string; operationalStatus?: OperationalStatus; driverConfirmed?: boolean; driverConfirmationAtUtc?: string };
type OperationalDisplay = { status: OperationalStatus; driverConfirmed: boolean; confirmationAt?: string };

function driverKey(name?: string, employeeNumber?: string) {
  return `${(name || "").trim().toLowerCase()}|${(employeeNumber || "").trim().toLowerCase()}`;
}

function statusClass(status: OperationalStatus) {
  return status === "Working" || status === "Completed"
    ? "confirmed"
    : status === "Dispatched"
      ? "awaiting"
      : status === "Awaiting Dispatch"
        ? "ready"
        : "empty";
}

function currentDispatchDate() {
  return new URLSearchParams(window.location.search).get("date") || new Date().toISOString().slice(0, 10);
}

export function DriverDispatchOperational() {
  const token = useAccessToken();
  const rootRef = useRef<HTMLDivElement>(null);
  const [operationalByDriver, setOperationalByDriver] = useState<Record<string, OperationalDisplay>>({});
  const [dispatchDate, setDispatchDate] = useState(currentDispatchDate);
  const [actionHost, setActionHost] = useState<HTMLElement>();

  const refreshOperationalStatuses = useCallback(async () => {
    try {
      const access = await token();
      const date = currentDispatchDate();
      const [workbench, response] = await Promise.all([
        request<Workbench>(`/api/v1/driver-dispatch?date=${encodeURIComponent(date)}`, access, undefined, 90000),
        request<{ drivers: OperationalDriverStatus[] }>(`/api/v1/driver-dispatch-status?date=${encodeURIComponent(date)}`, access, undefined, 90000)
      ]);
      const byId = Object.fromEntries(response.drivers.map(item => [item.driverId, item]));
      const next: Record<string, OperationalDisplay> = {};
      for (const driver of workbench.drivers) {
        const status = byId[driver.driverId];
        if (!status?.operationalStatus) continue;
        next[driverKey(driver.displayName, driver.employeeNumber)] = {
          status: status.operationalStatus,
          driverConfirmed: Boolean(status.driverConfirmed),
          confirmationAt: status.driverConfirmationAtUtc
        };
      }
      setOperationalByDriver(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    } catch {
      // The main Dispatch screen remains usable if the lightweight operational mirror is unavailable.
    }
  }, [token]);

  useEffect(() => {
    void refreshOperationalStatuses();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshOperationalStatuses();
    }, 30_000);
    const onFocus = () => void refreshOperationalStatuses();
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshOperationalStatuses(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshOperationalStatuses]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const locateHost = () => {
      const next = root.querySelector<HTMLElement>(".dispatch-title .dispatch-actions");
      setActionHost(current => current === next ? current : next || undefined);
    };
    locateHost();
    const observer = new MutationObserver(locateHost);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const apply = () => {
      for (const row of Array.from(root.querySelectorAll<HTMLTableRowElement>("table.dispatch-table tbody tr:not(.dispatch-group)"))) {
        const name = row.querySelector("td:first-child strong")?.textContent?.trim();
        const employeeNumber = row.querySelector("td:first-child small")?.textContent?.trim();
        const operational = operationalByDriver[driverKey(name, employeeNumber)];
        if (!operational) continue;
        const cell = row.querySelector<HTMLElement>(".dispatch-status-cell");
        const pill = cell?.querySelector<HTMLElement>(".dispatch-status-pill");
        if (pill) {
          if (pill.textContent !== operational.status) pill.textContent = operational.status;
          pill.classList.remove("confirmed", "awaiting", "ready", "empty");
          pill.classList.add(statusClass(operational.status));
          pill.setAttribute("data-operational-status", operational.status);
        }
        const existing = cell?.querySelector<HTMLElement>("[data-driver-confirmed]");
        if (operational.driverConfirmed) {
          if (!existing && cell) {
            const note = document.createElement("small");
            note.setAttribute("data-driver-confirmed", "true");
            note.textContent = "Driver confirmed";
            if (operational.confirmationAt) note.title = `Driver confirmed at ${operational.confirmationAt}`;
            cell.appendChild(note);
          }
        } else if (existing) {
          existing.remove();
        }
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [operationalByDriver]);

  // Do not intercept Dispatch. DriverDispatch owns allocation, route/readiness checks, the editable
  // text preview and the SMS send. The former overlay performed a second workbench read here and
  // could lose a just-saved allocation, producing the false “driver does not have a run” error.
  // This capture is passive: after the canonical SEND DISPATCH click, re-read operational status so
  // the pill changes to Dispatched promptly without remounting or interrupting the send request.
  function observeDispatchInteraction(event: SyntheticEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === "date") {
      setDispatchDate(target.value || currentDispatchDate());
      return;
    }
    const button = target.closest("button");
    if ((button?.textContent || "").trim().toLowerCase() !== "send dispatch") return;
    window.setTimeout(() => void refreshOperationalStatuses(), 1200);
    window.setTimeout(() => void refreshOperationalStatuses(), 3500);
  }

  function smartPlanLocked() {
    void refreshOperationalStatuses();
  }

  return <div ref={rootRef} onClickCapture={observeDispatchInteraction} onChangeCapture={observeDispatchInteraction}>
    <DispatchBoard planningDate={dispatchDate} onLocked={smartPlanLocked} />
    <BackloadMatchNotifications />
    <DriverDispatch />
    {actionHost && createPortal(<CustomerLoadPlanActions date={dispatchDate} />, actionHost)}
  </div>;
}
