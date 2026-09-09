import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { request, type LoadDispatch } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { DriverDispatch } from "./DriverDispatch";

type WorkbenchDriver = { driverId: string; employeeNumber?: string; displayName: string };
type WorkbenchLoad = { id: string; reference: string; rawReference?: string };
type Workbench = { drivers: WorkbenchDriver[]; loads: WorkbenchLoad[] };
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

function cleanStopName(value?: string) {
  return (value || "").replace(/^(?:Collect|Deliver)\s*[·:-]\s*/i, "").trim();
}

function loadNumber(reference?: string) {
  const match = String(reference || "").match(/(?:run|load)[^0-9]*(\d{1,3})\b/i)
    || String(reference || "").match(/\b(\d{1,3})\b/);
  return match?.[1] || String(reference || "").trim() || "TBC";
}

function fuelInstruction(dispatch: LoadDispatch) {
  const vehicle = dispatch.vehicle;
  if (!vehicle) return undefined;
  const parts: string[] = [];
  if (vehicle.fuelPin) parts.push(`Fuel Pin: ${vehicle.fuelPin}`);
  else parts.push("Fuel Pin: not set in Vehicle Master.");
  if (vehicle.bpPlainCard) parts.push("Please use Plain BP Card.");
  const avoid = [vehicle.bpRedCard ? "BP Card with Red Sticker" : undefined, vehicle.shellCard ? "Shell Card" : undefined].filter(Boolean);
  if (avoid.length) parts.push(`Avoid using ${avoid.join(" and ")}.`);
  return parts.join(" ");
}

function buildOperationalDispatchText(dispatch: LoadDispatch) {
  const firstName = dispatch.driver?.displayName?.trim().split(/\s+/)[0] || "Driver";
  const collections = dispatch.stops.filter(stop => /^collect\b/i.test(stop.name || ""));
  const deliveries = dispatch.stops.filter(stop => /^deliver\b/i.test(stop.name || ""));
  const deliveryNames = Array.from(new Set(deliveries.map(stop => cleanStopName(stop.name)).filter(Boolean)));
  const tomorrow = dispatch.stops.some(stop => stop.order?.deliveryDate && stop.order.deliveryDate > dispatch.planningDate);
  const collectionLines = collections.map(stop => {
    const destination = cleanStopName(stop.order?.deliveryName)
      || cleanStopName(deliveries.find(delivery => delivery.order?.reference && delivery.order.reference === stop.order?.reference)?.name)
      || "Destination TBC";
    const pallets = stop.order?.pallets != null ? `${stop.order.pallets}p` : "pallets TBC";
    return `${cleanStopName(stop.name)}  ${pallets}  ${destination}`;
  });
  const deliverySentence = deliveryNames.length === 0
    ? `${tomorrow ? "Tomorrow" : "Today"} please deliver as planned.`
    : deliveryNames.length === 1
      ? `${tomorrow ? "Tomorrow" : "Today"} please deliver to ${deliveryNames[0]}.`
      : `${tomorrow ? "Tomorrow" : "Today"} please deliver first to ${deliveryNames[0]}, then to ${deliveryNames.slice(1).join(", then to ")}.`;
  const notes = Array.from(new Set(dispatch.stops.map(stop => stop.order?.driverInstructions?.trim()).filter((value): value is string => Boolean(value))));

  return [
    `Hi ${firstName},`,
    dispatch.vehicle?.registration ? `${dispatch.vehicle.registration}${dispatch.trailer?.trailerNumber ? ` with ${dispatch.trailer.trailerNumber}` : ""}` : "",
    fuelInstruction(dispatch) || "",
    `You are doing Load Number ${loadNumber(dispatch.reference)}.`,
    "",
    "Today please load from:",
    ...(collectionLines.length ? collectionLines : ["Collection details TBC"]),
    "",
    deliverySentence,
    ...(notes.length ? ["", ...notes] : []),
    "",
    "Once empty please give the office a call.",
    "Please confirm.",
    "Thank you."
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n").trim();
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function DriverDispatchOperational() {
  const token = useAccessToken();
  const rootRef = useRef<HTMLDivElement>(null);
  const loadsRef = useRef<WorkbenchLoad[]>([]);
  const previewRequestRef = useRef<string>();
  const [operationalByDriver, setOperationalByDriver] = useState<Record<string, OperationalDisplay>>({});

  const refreshOperationalStatuses = useCallback(async () => {
    try {
      const access = await token();
      const date = new URLSearchParams(window.location.search).get("date") || new Date().toISOString().slice(0, 10);
      const [workbench, response] = await Promise.all([
        request<Workbench>(`/api/v1/driver-dispatch?date=${encodeURIComponent(date)}`, access, undefined, 90000),
        request<{ drivers: OperationalDriverStatus[] }>(`/api/v1/driver-dispatch-status?date=${encodeURIComponent(date)}`, access, undefined, 90000)
      ]);
      loadsRef.current = workbench.loads || [];
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

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const enhancePreview = () => {
      const modal = root.querySelector<HTMLElement>(".dispatch-modal");
      if (!modal) {
        previewRequestRef.current = undefined;
        return;
      }
      if (!/dispatch text preview/i.test(modal.querySelector(".eyebrow")?.textContent || "")) return;
      const reference = modal.querySelector("h2")?.textContent?.trim();
      const textarea = modal.querySelector<HTMLTextAreaElement>("textarea");
      if (!reference || !textarea) return;
      const load = loadsRef.current.find(item => item.reference === reference || item.rawReference === reference);
      if (!load || previewRequestRef.current === load.id) return;
      previewRequestRef.current = load.id;

      void (async () => {
        try {
          const dispatch = await request<LoadDispatch>(`/api/v1/runs/${encodeURIComponent(load.id)}/dispatch`, await token(), undefined, 90000);
          if (!root.contains(textarea)) return;
          setTextareaValue(textarea, buildOperationalDispatchText(dispatch));
        } catch {
          previewRequestRef.current = undefined;
        }
      })();
    };

    enhancePreview();
    const observer = new MutationObserver(enhancePreview);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [token]);

  function observeSendDispatch(event: MouseEvent<HTMLDivElement>) {
    const button = (event.target as HTMLElement).closest("button");
    if ((button?.textContent || "").trim().toLowerCase() !== "send dispatch") return;
    window.setTimeout(() => void refreshOperationalStatuses(), 1200);
    window.setTimeout(() => void refreshOperationalStatuses(), 3500);
  }

  return <div ref={rootRef} onClickCapture={observeSendDispatch}>
    <DriverDispatch />
  </div>;
}
