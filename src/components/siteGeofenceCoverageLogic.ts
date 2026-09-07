export type CoverageSite = {
  id: string;
  externalCode?: string;
  name?: string;
  driverTextName?: string;
  aliases?: string;
  active?: boolean;
};

export type CoverageStatus = {
  siteId: string;
  siteCode: string;
  siteName: string;
  linkedGeofences: string[];
  geofenceLinked: boolean;
  needsReview: boolean;
};

export type SiteCoverage = {
  sourceLabel: string;
  state: 'linked' | 'unlinked' | 'unresolved';
  siteCode?: string;
  siteName?: string;
  geofenceName?: string;
  action?: string;
};

export function normaliseCoverageKey(value?: string) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function splitAliases(value?: string) {
  return String(value || '').split(/[,;|\n\r]+/).map(item => item.trim()).filter(Boolean);
}

function variants(value: string) {
  const values: string[] = [];
  const seen = new Set<string>();
  const add = (candidate?: string) => {
    const clean = candidate?.trim();
    if (clean && !seen.has(clean)) { seen.add(clean); values.push(clean); }
  };
  add(value);
  add(value.replace(/^\s*(collect|deliver)\s*[·:-]\s*/i, ''));
  for (let index = 0; index < values.length; index += 1) {
    const candidate = values[index];
    add(candidate.replace(/\(\s*[+-]?\d+(?:\.\d+)?\s*°?\s*C\s*\)/gi, '').trim());
    add(candidate.replace(/\s+(CHILL|FRV)$/i, '').trim());
    // DOT/order names often append a store/location number that is not part of Site Master.
    add(candidate.replace(/\s+\d{2,6}\s*$/, '').trim());
    const separator = candidate.indexOf('-');
    if (separator > 0) {
      const prefix = candidate.slice(0, separator).trim().toUpperCase();
      if (['BAR', 'BARFOOTS', 'LAN', 'LANGMEADS', 'SB', 'GHS', 'SLH', 'NWF', 'WAITROSE', 'MORRISONS', 'ALDI'].includes(prefix)) {
        add(candidate.slice(separator + 1));
      }
    }
    const open = candidate.lastIndexOf('(');
    if (open > 0 && candidate.endsWith(')')) {
      const before = candidate.slice(0, open).trim();
      const inside = candidate.slice(open + 1, -1).trim();
      add(before);
      if (inside && !inside.includes('°')) add(inside);
    }
  }
  return values.map(normaliseCoverageKey).filter(Boolean);
}

function siteCandidates(site: CoverageSite) {
  return [site.externalCode, site.name, site.driverTextName, ...splitAliases(site.aliases)]
    .flatMap(candidate => variants(candidate || ''))
    .filter(Boolean);
}

function rawSiteCandidates(site: CoverageSite, status?: CoverageStatus) {
  return [site.externalCode, site.name, site.driverTextName, ...splitAliases(site.aliases), ...(status?.linkedGeofences || [])]
    .map(normaliseCoverageKey)
    .filter(Boolean);
}

export function resolveSiteCoverage(label: string, sites: CoverageSite[], statuses: CoverageStatus[]): SiteCoverage {
  const keys = variants(label);
  const sourceKey = normaliseCoverageKey(label);
  const activeSites = sites.filter(site => site.active !== false);
  const exactMatches = activeSites.filter(site => rawSiteCandidates(site, statuses.find(status => status.siteId === site.id)).includes(sourceKey));
  const variantMatches = activeSites.filter(site => {
    const linkedNames = statuses.find(status => status.siteId === site.id)?.linkedGeofences || [];
    const candidates = [...siteCandidates(site), ...linkedNames.flatMap(variants)];
    return candidates.some(candidate => keys.includes(candidate));
  });
  const matches = exactMatches.length > 0 ? exactMatches : variantMatches;
  const unique = Array.from(new Map(matches.map(site => [site.id, site])).values());
  if (unique.length !== 1) {
    return {
      sourceLabel: label,
      state: 'unresolved',
      action: unique.length > 1
        ? 'More than one Site matches this wording. Remove duplicate/ambiguous aliases in the Site Master record.'
        : 'Add this wording as an alias to the correct Site Master record.',
    };
  }
  const site = unique[0];
  const status = statuses.find(item => item.siteId === site.id);
  if (!status?.geofenceLinked) {
    return {
      sourceLabel: label,
      state: 'unlinked',
      siteCode: status?.siteCode || site.externalCode,
      siteName: status?.siteName || site.driverTextName || site.name,
      action: 'Site is recognised but has no active geofence. Open the Site Master record and link or create its geofence there.',
    };
  }
  return {
    sourceLabel: label,
    state: 'linked',
    siteCode: status.siteCode || site.externalCode,
    siteName: status.siteName || site.driverTextName || site.name,
    geofenceName: status.linkedGeofences.join(', '),
  };
}
