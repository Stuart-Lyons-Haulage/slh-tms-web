import { OperationsWallboard as ExistingOperationsWallboard } from "./OperationsWallboardLive";
import { RunGeofenceLinkagePanel } from "./RunGeofenceLinkagePanel";
import "../run-geofence-linkage.css";

/**
 * Operations wallboard shell.
 *
 * ETA values are supplied directly by the canonical /operations/delivery-etas
 * server feed consumed by OperationsWallboardLive. Do not replace those values
 * in the browser with /run-timing data: that endpoint is progression evidence,
 * not a customer ETA authority, and using it to overwrite delivery ETAs can move
 * predicted arrivals by hours and incorrectly mark otherwise healthy runs late.
 *
 * The paired TV passes the same display key into the same live wallboard, so the
 * signed-in wallboard and TV now share one server ETA snapshot and one status model.
 */
export function OperationsWallboard({ tvMode = false, tvAccessKey }: { tvMode?: boolean; tvAccessKey?: string }) {
  return <>
    {!tvMode && <RunGeofenceLinkagePanel />}
    <ExistingOperationsWallboard tvMode={tvMode} tvAccessKey={tvAccessKey} />
  </>;
}
