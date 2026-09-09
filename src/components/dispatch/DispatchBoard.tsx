import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccessToken } from "../../lib/auth";
import "../../smart-dispatch.css";
import { ComplianceWarningBanner } from "./ComplianceWarningBanner";
import { DispatchDriverRow } from "./DispatchDriverRow";
import { DispatchFilters } from "./DispatchFilters";
import { getAvailableTimes, getSmartDispatch, lockDispatchPlan } from "./dispatchApi";
import {
  applyAvailableTimes,
  availableTimesByDriver,
  buildInitialSelections,
  buildRunOwnerById,
  emptyDispatchSelection,
  filterDispatchDrivers,
  filterDriversByEmploymentType,
  globalFailures,
  rowFailures,
  selectedAllocations,
  validateLockSelections,
  type DispatchAvailableTimeMap,
  type DispatchSelectionMap
} from "./dispatchBoardState";
import type { DispatchEmploymentFilter, DispatchFilter, DispatchLockFailure } from "./types";

type Props = {
  planningDate: string;
  onLocked?: () => void;
};

type SmartDispatchSnapshot = Awaited<ReturnType<typeof getSmartDispatch>>;
type ActionState = "times" | "lock" | "refresh" | undefined;

const filterValues: DispatchFilter[] = ["all", "unallocated", "backloads", "warnings", "skills-mismatch"];
const employmentFilterValues: DispatchEmploymentFilter[] = ["all", "employed", "agency", "casual", "subcontractor"];

export function GetTimesButton({ busy, onGetTimes }: { busy: boolean; onGetTimes: () => void }) {
  return <button className="smart-action secondary" type="button" disabled={busy} onClick={onGetTimes}>
    {busy ? "Getting Tacho times…" : "Get Times"}
  </button>;
}

export function LockPlanButton({ busy, disabled, onLock }: { busy: boolean; disabled: boolean; onLock: () => void }) {
  return <button className="smart-action primary" type="button" disabled={busy || disabled} onClick={onLock}>
    {busy ? "Validating & locking…" : "Lock Plan"}
  </button>;
}

export function DispatchBoard({ planningDate, onLocked }: Props) {
  const token = useAccessToken();
  const [snapshot, setSnapshot] = useState<SmartDispatchSnapshot>();
  const [selections, setSelections] = useState<DispatchSelectionMap>({});
  const [availableTimes, setAvailableTimes] = useState<DispatchAvailableTimeMap>({});
  const [failures, setFailures] = useState<DispatchLockFailure[]>([]);
  const [filter, setFilter] = useState<DispatchFilter>("all");
  const [employmentFilter, setEmploymentFilter] = useState<DispatchEmploymentFilter>("all");
  const [action, setAction] = useState<ActionState>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async () => {
    setAction(current => current || "refresh");
    setError(undefined);
    try {
      const access = await token();
      const data = await getSmartDispatch(planningDate, access);
      setSnapshot(data);
      setSelections(buildInitialSelections(data.drivers, data.runs, data.equipment));
      setAvailableTimes({});
      setFailures([]);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Smart Dispatch could not be loaded.");
    } finally {
      setAction(undefined);
    }
  }, [planningDate, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runOwnerById = useMemo(
    () => snapshot ? buildRunOwnerById(selections, snapshot.equipment) : {},
    [selections, snapshot]
  );

  const visibleDrivers = useMemo(() => {
    if (!snapshot) return [];
    const workforce = filterDriversByEmploymentType(snapshot.drivers, employmentFilter);
    return filterDispatchDrivers(workforce, filter, selections, snapshot.runs, availableTimes, failures);
  }, [availableTimes, employmentFilter, failures, filter, selections, snapshot]);

  const filterCounts = useMemo(() => {
    const workforce = snapshot ? filterDriversByEmploymentType(snapshot.drivers, employmentFilter) : [];
    return Object.fromEntries(filterValues.map(value => [
      value,
      snapshot ? filterDispatchDrivers(workforce, value, selections, snapshot.runs, availableTimes, failures).length : 0
    ])) as Record<DispatchFilter, number>;
  }, [availableTimes, employmentFilter, failures, selections, snapshot]);

  const employmentCounts = useMemo(() => Object.fromEntries(employmentFilterValues.map(value => [
    value,
    snapshot ? filterDriversByEmploymentType(snapshot.drivers, value).length : 0
  ])) as Record<DispatchEmploymentFilter, number>, [snapshot]);

  const selectedCount = snapshot ? selectedAllocations(snapshot.drivers, selections).length : 0;
  const globalLockFailures = useMemo(() => {
    const driverIds = new Set(snapshot?.drivers.map(driver => driver.driverId) || []);
    return globalFailures(failures, driverIds);
  }, [failures, snapshot]);

  function changeSelection(driverId: string, patch: Partial<DispatchSelectionMap[string]>) {
    setSelections(current => ({
      ...current,
      [driverId]: { ...(current[driverId] || emptyDispatchSelection()), ...patch }
    }));
    setFailures(current => current.filter(failure => failure.driverId !== driverId));
    setNotice(undefined);
  }

  async function handleGetTimes() {
    if (!snapshot || snapshot.drivers.length === 0) return;
    setAction("times");
    setError(undefined);
    setNotice(undefined);
    setFailures([]);
    try {
      const access = await token();
      const rows = await getAvailableTimes(planningDate, snapshot.drivers.map(driver => driver.driverId), access);
      setAvailableTimes(availableTimesByDriver(rows));
      setSelections(current => applyAvailableTimes(current, rows));
      const warnings = rows.filter(row => Boolean(row.breachDetail)).length;
      setNotice(warnings > 0
        ? `Tacho times refreshed for ${rows.length} drivers · ${warnings} require planner attention.`
        : `Tacho times refreshed for ${rows.length} drivers.`);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Tacho available times could not be calculated.");
    } finally {
      setAction(undefined);
    }
  }

  async function handleLockPlan() {
    if (!snapshot) return;
    setError(undefined);
    setNotice(undefined);

    const allocations = selectedAllocations(snapshot.drivers, selections);
    if (allocations.length === 0) {
      setFailures([{ driverId: "", reason: "Allocate at least one run before locking the plan." }]);
      return;
    }

    const localFailures = validateLockSelections(snapshot.drivers, snapshot.runs, snapshot.equipment, selections, availableTimes);
    if (localFailures.length > 0) {
      setFailures(localFailures);
      setNotice("Plan not locked. Resolve the highlighted rows; no allocations were written.");
      return;
    }

    setAction("lock");
    setFailures([]);
    try {
      const access = await token();
      const result = await lockDispatchPlan(planningDate, allocations, access);
      if (!result.success) {
        setFailures(result.failures);
        setNotice("Plan not locked. Server validation rejected the plan and no allocations were written.");
        return;
      }

      await refresh();
      setNotice(`Plan locked atomically · ${allocations.length} run${allocations.length === 1 ? "" : "s"} allocated.`);
      onLocked?.();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The Dispatch plan could not be locked.");
    } finally {
      setAction(undefined);
    }
  }

  if (!snapshot && action === "refresh") {
    return <section className="smart-dispatch-board"><div className="smart-dispatch-loading">Building smart Dispatch plan…</div></section>;
  }

  if (!snapshot) {
    return <section className="smart-dispatch-board">
      <div className="smart-dispatch-error">
        <strong>Smart Dispatch unavailable</strong>
        <span>{error || "The planning data could not be loaded."}</span>
        <button type="button" onClick={() => void refresh()}>Retry</button>
      </div>
    </section>;
  }

  return <section className="smart-dispatch-board" aria-label="Smart Dispatch planning board">
    <header className="smart-dispatch-header">
      <div>
        <span className="smart-eyebrow">Planning intelligence</span>
        <h2>Smart Dispatch</h2>
        <p>{planningDate} · Recent Tacho/live drivers, skill-gated allocation and return/backload matching.</p>
      </div>
      <div className="smart-dispatch-actions">
        <button className="smart-action ghost" type="button" disabled={Boolean(action)} onClick={() => void refresh()}>
          {action === "refresh" ? "Refreshing…" : "Refresh"}
        </button>
        <GetTimesButton busy={action === "times"} onGetTimes={() => void handleGetTimes()} />
        <LockPlanButton busy={action === "lock"} disabled={selectedCount === 0 || Boolean(action && action !== "lock")} onLock={() => void handleLockPlan()} />
      </div>
    </header>

    <ComplianceWarningBanner drivers={snapshot.drivers} availableTimes={availableTimes} failures={failures} />

    {notice && <div className="smart-dispatch-notice" role="status">{notice}</div>}
    {error && <div className="smart-dispatch-error inline" role="alert">{error}</div>}
    {globalLockFailures.map((failure, index) => <div className="smart-dispatch-error inline" role="alert" key={`${failure.reason}-${index}`}>{failure.reason}</div>)}

    <div className="smart-dispatch-summary">
      <span><strong>{snapshot.drivers.length}</strong> recent/operational drivers</span>
      <span><strong>{snapshot.visibility.windowDays}</strong> day rolling window</span>
      <span><strong>{snapshot.runs.length}</strong> runs</span>
      <span><strong>{selectedCount}</strong> allocated in plan</span>
      <span><strong>{snapshot.drivers.filter(driver => driver.backloadCandidate).length}</strong> backload candidates</span>
    </div>

    <DispatchFilters
      value={filter}
      counts={filterCounts}
      onChange={setFilter}
      employmentValue={employmentFilter}
      employmentCounts={employmentCounts}
      onEmploymentChange={setEmploymentFilter}
    />

    <div className="smart-dispatch-table-wrap">
      <table className="smart-dispatch-table">
        <thead>
          <tr>
            <th>Driver</th>
            <th>Duty</th>
            <th>Last location / fit</th>
            <th>Skills</th>
            <th>Run</th>
            <th>Vehicle</th>
            <th>Trailer</th>
            <th>Available / WTD</th>
          </tr>
        </thead>
        <tbody>
          {visibleDrivers.map(driver => <DispatchDriverRow
            key={driver.driverId}
            driver={driver}
            runs={snapshot.runs}
            vehicles={snapshot.equipment.vehicles}
            trailers={snapshot.equipment.trailers}
            runOwnerById={runOwnerById}
            selection={selections[driver.driverId] || emptyDispatchSelection()}
            availableTime={availableTimes[driver.driverId]}
            failures={rowFailures(failures, driver.driverId)}
            onSelectionChange={changeSelection}
          />)}
        </tbody>
      </table>
      {visibleDrivers.length === 0 && <div className="smart-dispatch-empty">No drivers match this filter.</div>}
    </div>

    <p className="smart-dispatch-footnote">Only drivers with rolling {snapshot.visibility.windowDays}-day Tacho/live operational evidence are shown by default, plus allocated, rostered agency and subcontractor exceptions. Lock Plan validates the complete selection again on the API before any write.</p>
  </section>;
}
