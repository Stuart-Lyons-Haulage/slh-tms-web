import { canDriverTakeRun, dispatchSkills, parseSkillFlags, tachoVehicleId, trailerEligible, ukTime, wtdClass } from "./dispatchRules";
import { dispatchActionForStatus } from "./dispatchMessaging";
import type {
  DispatchAllocationSelection,
  DispatchAvailableTimeDto,
  DispatchDriverDto,
  DispatchDriverStatusDto,
  DispatchEquipmentTrailer,
  DispatchEquipmentVehicle,
  DispatchLockFailure,
  DispatchRunDto
} from "./types";

type Props = {
  driver: DispatchDriverDto;
  runs: DispatchRunDto[];
  vehicles: DispatchEquipmentVehicle[];
  trailers: DispatchEquipmentTrailer[];
  runOwnerById: Record<string, string | undefined>;
  selection: DispatchAllocationSelection;
  availableTime?: DispatchAvailableTimeDto;
  status?: DispatchDriverStatusDto;
  lockedRunId?: string;
  failures: DispatchLockFailure[];
  busy: boolean;
  onSelectionChange: (driverId: string, patch: Partial<DispatchAllocationSelection>) => void;
  onDispatch: (driver: DispatchDriverDto, selection: DispatchAllocationSelection) => void;
  onAmend: (driver: DispatchDriverDto, selection: DispatchAllocationSelection) => void;
  onUpdate: (driver: DispatchDriverDto, selection: DispatchAllocationSelection) => void;
};

function employmentLabel(value: string): string {
  if (value === "HalfTramper") return "Half Tramper";
  if (value === "AgencyDay") return "Agency Day";
  if (value === "AgencyLong") return "Agency Long";
  if (value === "Subcontractor") return "Subbie";
  return value;
}

function dayTone(driver: DispatchDriverDto): string {
  if (driver.needsReturn && driver.tachoData.currentDutyDay >= 5) return "red";
  if (driver.needsReturn && driver.tachoData.currentDutyDay >= 4) return "amber";
  return "ok";
}

function statusTone(status?: string): string {
  if (status === "Confirmed" || status === "Completed") return "confirmed";
  if (status === "Sent Awaiting Response" || status === "Dispatched" || status === "Working") return "awaiting";
  if (status === "Awaiting Dispatch") return "ready";
  return "empty";
}

export function DispatchDriverRow({
  driver,
  runs,
  vehicles,
  trailers,
  runOwnerById,
  selection,
  availableTime,
  status,
  lockedRunId,
  failures,
  busy,
  onSelectionChange,
  onDispatch,
  onAmend,
  onUpdate
}: Props) {
  const heldSkills = parseSkillFlags(driver.skills);
  const visibleSkills = dispatchSkills.filter(item => heldSkills.has(item.skill));
  const selectedRun = runs.find(run => run.runId === selection.runId);
  const legalRuns = runs.filter(run => {
    const owner = runOwnerById[run.runId];
    return canDriverTakeRun(driver, run) && (!owner || owner === driver.driverId);
  });
  const legalTrailers = trailers.filter(trailer => trailerEligible(selectedRun, trailer));
  const tachoVehicle = tachoVehicleId(driver, vehicles);
  const wtdHours = availableTime?.weeklyWorkingTimeUsed ?? driver.tachoData.weeklyWorkingTime;
  const wtdTone = availableTime?.wtdStatus || wtdClass(wtdHours);
  const blocked = driver.isBlocked;
  const blockedText = driver.blockedReason || "Unavailable";
  const lockedToDriver = Boolean(selection.runId && lockedRunId === selection.runId);
  const dispatchStatus = status?.dispatchStatus || (lockedToDriver ? "Awaiting Dispatch" : "No Run");
  const action = dispatchActionForStatus(lockedToDriver, dispatchStatus);

  function changeRun(runId: string) {
    const nextRun = runs.find(run => run.runId === runId);
    const currentTrailer = trailers.find(trailer => trailer.id === selection.trailerId);
    onSelectionChange(driver.driverId, {
      runId,
      trailerId: currentTrailer && trailerEligible(nextRun, currentTrailer) ? currentTrailer.id : ""
    });
  }

  return <tr className={blocked ? "smart-dispatch-row blocked" : driver.needsReturn ? "smart-dispatch-row return-needed" : "smart-dispatch-row"}>
    <td className="smart-driver-cell">
      <strong>{driver.name}</strong>
      <div className="smart-driver-meta">
        <span className="employment-badge">{employmentLabel(driver.employmentType)}</span>
        {driver.driverCode?.trim() && <small>{driver.driverCode.trim()}</small>}
      </div>
    </td>

    <td>
      <span className={`smart-day ${dayTone(driver)}`}>Day {status?.projectedDayNumber || driver.tachoData.currentDutyDay}</span>
      {driver.needsReturn && <small className="smart-inline-warning">{driver.tachoData.currentDutyDay >= 5 ? "Return priority" : "Return soon"}</small>}
    </td>

    <td className="smart-location-cell">
      <strong>{driver.trackingData.lastStopName || "Location unavailable"}</strong>
      {driver.distanceToSuggestedCollectionMiles != null && driver.suggestedRunReference &&
        <small>{driver.distanceToSuggestedCollectionMiles.toFixed(1)}mi to suggested collection · {driver.suggestedRunReference}</small>}
      {driver.suggestion && <small className={driver.needsReturn && !driver.backloadCandidate ? "smart-inline-warning" : ""}>{driver.suggestion}</small>}
    </td>

    <td className="smart-skills-cell">
      {visibleSkills.map(item => <span key={item.skill} className="smart-skill held" title={item.label}>{item.badge}</span>)}
    </td>

    {blocked ? <>
      <td><span className="smart-blocked-label">{blockedText}</span></td>
      <td><span className="smart-blocked-label">{blockedText}</span></td>
      <td><span className="smart-blocked-label">{blockedText}</span></td>
    </> : <>
      <td>
        <select aria-label={`Run for ${driver.name}`} value={selection.runId} onChange={event => changeRun(event.target.value)} disabled={lockedToDriver && dispatchStatus !== "No Run"}>
          <option value="">Run…</option>
          {legalRuns.map(run => <option key={run.runId} value={run.runId}>
            {run.reference}{run.runId === driver.suggestedRunId ? driver.backloadCandidate ? " · Backload candidate" : " · Suggested" : ""}
          </option>)}
        </select>
      </td>
      <td>
        <select aria-label={`Vehicle for ${driver.name}`} value={selection.vehicleId} onChange={event => onSelectionChange(driver.driverId, { vehicleId: event.target.value })} disabled={lockedToDriver && dispatchStatus !== "No Run"}>
          <option value="">Vehicle…</option>
          {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>
            {vehicle.registration}{vehicle.id === tachoVehicle ? " · Tacho: last used" : ""}
          </option>)}
        </select>
        {driver.tachoData.lastVehicleRegistration && <small>Tacho: last used · {driver.tachoData.lastVehicleRegistration}</small>}
      </td>
      <td>
        <select aria-label={`Trailer for ${driver.name}`} value={selection.trailerId} onChange={event => onSelectionChange(driver.driverId, { trailerId: event.target.value })} disabled={lockedToDriver && dispatchStatus !== "No Run"}>
          <option value="">Trailer…</option>
          {legalTrailers.map(trailer => <option key={trailer.id} value={trailer.id}>{trailer.trailerNumber}{trailer.type ? ` · ${trailer.type}` : ""}</option>)}
        </select>
        {selectedRun?.requiresDoubleDeck && <small>Double-deck only</small>}
        {selectedRun?.requiresRefrigerated && <small>Refrigerated only</small>}
      </td>
    </>}

    <td className="smart-available-cell">
      {!availableTime ? <>
        <strong>{status?.earliestStartUtc ? ukTime(status.earliestStartUtc) : "—"}</strong>
        <span className="smart-muted">{status?.earliestStartUtc ? status.earliestStartIsAssumption ? "Assumed start" : "Tacho start" : "Get times"}</span>
      </> : <>
        <strong>{ukTime(availableTime.availableFrom)}</strong>
        <small>{availableTime.requiredRestPeriod}h Tacho rest · WTD {availableTime.weeklyWorkingTimeUsed.toFixed(1)}h</small>
        <div className={`smart-wtd-bar ${wtdTone}`} title={`WTD ${availableTime.weeklyWorkingTimeUsed.toFixed(1)} hours`}>
          <span style={{ width: `${Math.min(100, Math.max(0, availableTime.weeklyWorkingTimeUsed / 60 * 100))}%` }} />
        </div>
        {selection.plannedStartTime && <small>Plan start · {ukTime(selection.plannedStartTime)}</small>}
        {availableTime.breachDetail && <small className="smart-inline-error">{availableTime.breachDetail}</small>}
      </>}
      {failures.map((failure, index) => <small className="smart-inline-error" key={`${failure.reason}-${index}`}>{failure.reason}</small>)}
    </td>

    <td className="smart-status-cell">
      <span className={`smart-status-pill ${statusTone(status?.operationalStatus || dispatchStatus)}`}>{status?.operationalStatus || dispatchStatus}</span>
      {status?.driverConfirmed && <small>Driver confirmed</small>}
      {status?.lastDriverReply && <small title={status.lastDriverReply}>{status.lastDriverReply.length > 60 ? `${status.lastDriverReply.slice(0, 60)}…` : status.lastDriverReply}</small>}
      {status?.availabilityStatus === "Unavailable" && <small className="smart-inline-error">{status.availabilityMessage || "Tacho unavailable"}</small>}
    </td>

    <td className="smart-dispatch-action-cell">
      {action === "allocate" && selection.runId && <small>Lock Plan to allocate and enable Dispatch.</small>}
      {action === "dispatch" && lockedToDriver && <button className="smart-action primary" type="button" disabled={busy || blocked || status?.availabilityStatus === "Unavailable"} onClick={() => onDispatch(driver, selection)}>{busy ? "Preparing…" : "Dispatch"}</button>}
      {action === "amend" && lockedToDriver && <>
        <button className="smart-action secondary" type="button" disabled={busy} onClick={() => onAmend(driver, selection)}>{busy ? "Working…" : "Amendment"}</button>
        <button className="smart-action ghost dark" type="button" disabled={busy} onClick={() => onUpdate(driver, selection)}>Update text</button>
      </>}
    </td>
  </tr>;
}
