from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Expected marker missing in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# Planner components: local createRun handlers were shadowing the canonical API import.
for path in ["src/pages/PlannerV2.tsx", "src/pages/PlannerV3.tsx"]:
    replace_once(
        path,
        "import { allocateRun, getRunRoute, listRuns, updateRunOperational, updateRunStops } from '../api/runs';",
        "import { allocateRun, createRun as createRunApi, getRunRoute, listRuns, updateRunOperational, updateRunStops } from '../api/runs';",
    )
    replace_once(path, "const created = await createRun({", "const created = await createRunApi({")

replace_once(
    "src/pages/OperationalPlanner.tsx",
    "import { allocateRun, getRunRoute, listRuns, updateRunStops } from '../api/runs';",
    "import { allocateRun, createRun as createRunApi, getRunRoute, listRuns, updateRunStops } from '../api/runs';",
)
replace_once("src/pages/OperationalPlanner.tsx", "const load = await createRun({", "const load = await createRunApi({")

# TachoMaster sync response uses matched, not the old untyped changed property.
replace_once(
    "src/pages/DriversOperational.tsx",
    "setMessage(result.message || `${result.changed} drivers updated from TachoMaster.`);",
    "setMessage(result.message || `${result.matched} drivers updated from TachoMaster.`);",
)

# Synthetic tracking fallbacks must satisfy the real FleetVehicleStatus contract.
p = Path("src/pages/Pages.tsx")
text = p.read_text()
text = text.replace(
    "condition: 'NotSignedOn' }))",
    "condition: 'NotSignedOn', driverMismatch: false }))",
)
text = text.replace(
    "condition: 'NotSignedOn' as const };",
    "condition: 'NotSignedOn' as const, driverMismatch: false };",
)
text = text.replace(
    "longitude: record.longitude };",
    "longitude: record.longitude, driverMismatch: false };",
)
p.write_text(text)

# Restore the pure planning helpers that their regression tests exercise.
p = Path("src/pages/DriverDispatch.tsx")
text = p.read_text()
text = text.replace(
    "  status: string;\n  vehicleId?: string;",
    "  status: string;\n  southbound?: boolean;\n  vehicleId?: string;",
    1,
)
text = text.replace(
    "stops: Array<{ id: string; sequence: number; name: string; plannedArrivalUtc?: string }>;",
    "stops: Array<{ id: string; sequence: number; name: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string }>;",
    1,
)
old = '''function compactRun(load?: DispatchLoad) {
  if (!load) return "—";
  const match = `${load.reference} ${load.rawReference}`.match(/\\b(?:run\\s*)?(\\d{1,3})\\b/i);
  const core = match?.[1] || load.reference;
  return `Run ${core}`;
}
function suggestionRunLabel(load?: DispatchLoad) { return compactRun(load); }
function firstCollectionTime(load?: DispatchLoad) {
  if (!load?.stops?.length) return "";
  return localTime([...load.stops].sort((a, b) => a.sequence - b.sequence)[0]?.plannedArrivalUtc);
}
'''
new = '''function compactRun(load?: DispatchLoad) {
  if (!load) return "—";
  const match = `${load.reference} ${load.rawReference}`.match(/\\b(?:run\\s*)?(\\d{1,3})\\b/i);
  const core = match?.[1] || load.reference;
  return `Run ${core}`;
}
function cleanStopName(value?: string) {
  return (value || "").replace(/^(?:Collect|Deliver)\\s*[·:-]\\s*/i, "").replace(/-/g, " ").trim();
}
function orderedStops(load?: DispatchLoad) { return [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence); }
// eslint-disable-next-line react-refresh/only-export-components
export function firstCollectionStop(load?: DispatchLoad) {
  const stops = orderedStops(load);
  return stops.find(stop => /^Collect\\b/i.test(stop.name || "")) || stops[0];
}
function finalDestinationStop(load?: DispatchLoad) {
  const stops = orderedStops(load);
  return [...stops].reverse().find(stop => /^Deliver\\b/i.test(stop.name || "")) || stops.at(-1);
}
// eslint-disable-next-line react-refresh/only-export-components
export function suggestionRunLabel(load?: DispatchLoad) {
  if (!load) return "—";
  const match = `${load.reference} ${load.rawReference}`.match(/\\b(?:run\\s*)?(\\d{1,3})\\b/i);
  const run = match?.[1] ? `Run ${Number(match[1])}` : load.reference;
  const destination = cleanStopName(finalDestinationStop(load)?.name);
  return destination ? `${run} ${destination}` : run;
}
// eslint-disable-next-line react-refresh/only-export-components
export function runDirection(load: DispatchLoad) {
  const stops = orderedStops(load).filter(stop => stop.latitude != null && stop.longitude != null);
  const first = stops[0];
  const final = finalDestinationStop(load);
  if (first?.latitude != null && final?.latitude != null) {
    const delta = final.latitude - first.latitude;
    if (delta >= 0.35) return "Northern";
    if (delta <= -0.35) return "Southern";
  }
  if (load.southbound) return "Southern";
  return "Local / Other";
}
function firstCollectionTime(load?: DispatchLoad) {
  return localTime(firstCollectionStop(load)?.plannedArrivalUtc);
}
'''
if old not in text and "export function firstCollectionStop" not in text:
    raise SystemExit("DriverDispatch helper marker missing")
if old in text:
    text = text.replace(old, new, 1)
p.write_text(text)
