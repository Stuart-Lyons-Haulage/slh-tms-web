export type PlanningStop = {
  id: string;
  sequence: number;
  name: string;
  latitude?: number;
  longitude?: number;
};

export type PlanningLoad = {
  reference?: string;
  rawReference?: string;
  southbound?: boolean;
  stops: PlanningStop[];
};

function orderedStops(load?: PlanningLoad) { return [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence); }
function compactRun(load?: PlanningLoad) {
  if (!load) return "—";
  const match = `${load.reference || ""} ${load.rawReference || ""}`.match(/\b(?:run\s*)?(\d{1,3})\b/i);
  return `${load.southbound ? "SB " : ""}${match?.[1] || load.reference || "—"}`;
}
function cleanStopName(value?: string) { return (value || "").replace(/^(?:Collect|Deliver)\s*[·:-]\s*/i, "").replace(/-/g, " ").trim(); }

export function firstCollectionStop(load?: PlanningLoad) {
  const stops = orderedStops(load);
  return stops.find(stop => /^Collect\b/i.test(stop.name || "")) || stops[0];
}

export function suggestionRunLabel(load?: PlanningLoad) {
  const run = compactRun(load);
  const label = run.startsWith("SB ") ? `SB Run ${run.slice(3)}` : `Run ${run}`;
  const destination = cleanStopName(orderedStops(load).at(-1)?.name);
  return destination ? `${label} ${destination}` : label;
}

export function runDirection(load: PlanningLoad) {
  const mapped = orderedStops(load).filter(stop => stop.latitude != null && stop.longitude != null);
  const first = mapped[0];
  const final = orderedStops(load).at(-1);
  if (first?.latitude != null && final?.latitude != null) {
    const delta = final.latitude - first.latitude;
    if (delta >= 0.35) return "Northern";
    if (delta <= -0.35) return "Southern";
  }
  return load.southbound ? "Southern" : "Local / Other";
}
