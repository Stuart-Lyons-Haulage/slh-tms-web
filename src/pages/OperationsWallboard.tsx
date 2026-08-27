// Use the live wallboard directly. The geofence-timing adapter was filtering
// completed runs out of loads, ETA, run-progress and route-progress responses,
// which caused rows and stops to disappear on a later refresh. The live
// wallboard already retains completed journeys and presents them as AVAILABLE.
export { OperationsWallboard } from "./OperationsWallboardLive";
