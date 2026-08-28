const INTERNAL_RUN_REFERENCE = /^PLAN-\d{8}-(.+)$/i;
const NUMERIC_RUN = /^(?:RUN[\s:_-]*)?(\d+)(?:[\s_-]*(AM|PM))?$/i;
const LEGACY_LOAD_RUN = /^L0*(\d+)$/i;
const PERIOD = /\b(AM|PM)\b/i;

function noteValue(notes: string | undefined, key: string) {
  if (!notes) return undefined;
  const prefix = `${key}:`;
  return notes
    .split("|")
    .map(part => part.trim())
    .find(part => part.toLowerCase().startsWith(prefix.toLowerCase()))
    ?.slice(prefix.length)
    .trim();
}

function explicitPeriod(value?: string) {
  if (!value) return undefined;
  const match = value.match(PERIOD);
  if (match) return match[1].toUpperCase();
  if (/morning/i.test(value)) return "AM";
  if (/afternoon|evening/i.test(value)) return "PM";
  return undefined;
}

function periodFromLocalHour(hour: number) {
  return hour >= 12 ? "PM" : "AM";
}

function periodFromLocalTime(value?: string) {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{1,2})(?::\d{2})?/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? periodFromLocalHour(hour) : undefined;
}

function periodFromPlannedUtc(firstPlannedUtc?: string) {
  if (!firstPlannedUtc) return undefined;
  const localPeriod = periodFromLocalTime(firstPlannedUtc);
  if (localPeriod) return localPeriod;
  const value = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(firstPlannedUtc) ? firstPlannedUtc : `${firstPlannedUtc}Z`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
  return periodFromLocalHour(Number(hour));
}

function stripInternalReference(reference: string) {
  const match = reference.trim().match(INTERNAL_RUN_REFERENCE);
  return match ? match[1] : reference.trim();
}

function legacyOperationalRunNumber(source: string) {
  const match = source.trim().match(LEGACY_LOAD_RUN);
  if (!match) return undefined;
  const legacyNumber = Number(match[1]);
  return Number.isInteger(legacyNumber) && legacyNumber > 0 ? legacyNumber : undefined;
}

function formatChoice(source: string, period?: string) {
  const clean = source.trim();
  const resolvedPeriod = period || explicitPeriod(clean);
  const legacyNumber = legacyOperationalRunNumber(clean);
  if (legacyNumber != null) {
    return `Run ${legacyNumber}${resolvedPeriod ? ` ${resolvedPeriod}` : ""}`;
  }

  const numeric = clean.match(NUMERIC_RUN);
  if (numeric) {
    const number = String(Number(numeric[1]));
    const numericPeriod = period || explicitPeriod(numeric[2]) || resolvedPeriod;
    return `Run ${number}${numericPeriod ? ` ${numericPeriod}` : ""}`;
  }

  const embeddedPeriod = explicitPeriod(clean);
  const withoutRun = clean.replace(/^RUN[\s:_-]*/i, "").replace(/[-_]+/g, " ").trim() || "TBC";
  const withoutPeriod = embeddedPeriod ? withoutRun.replace(PERIOD, "").trim() : withoutRun;
  return `Run ${withoutPeriod}${resolvedPeriod ? ` ${resolvedPeriod}` : ""}`;
}

function operationalSource(source: string, plannedPeriod?: string) {
  if (!plannedPeriod || !NUMERIC_RUN.test(source.trim())) return source;
  return source.replace(PERIOD, "").trim();
}

export function displayRunReference(reference: string, plannerNotes?: string, firstPlannedUtc?: string) {
  const plannerRun = noteValue(plannerNotes, "Planner run");
  const runType = noteValue(plannerNotes, "Run type");
  const plannedPeriod = periodFromPlannedUtc(firstPlannedUtc);
  const source = operationalSource(plannerRun || stripInternalReference(reference), plannedPeriod);
  const period = plannedPeriod || explicitPeriod(source) || explicitPeriod(runType);
  return formatChoice(source, period);
}

export function displayPlannerRunChoice(plannerRun?: string, runType?: string, fallbackReference?: string, firstPlannedUtc?: string) {
  const plannedPeriod = periodFromPlannedUtc(firstPlannedUtc);
  const source = operationalSource(plannerRun?.trim() || (fallbackReference ? stripInternalReference(fallbackReference) : "TBC"), plannedPeriod);
  const period = plannedPeriod || explicitPeriod(source) || explicitPeriod(runType);
  return formatChoice(source, period);
}
