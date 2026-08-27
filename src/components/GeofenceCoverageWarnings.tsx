/* eslint-disable react-refresh/only-export-components */
import { Link } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type RunLinkageIssue = {
  loadId: string;
  run: string;
  stopId: string;
  sequence: number;
  stopName: string;
  finalDelivery: boolean;
  siteMatched: boolean;
  siteCode?: string;
  siteName?: string;
  geofenceLinked: boolean;
  geofenceName?: string;
  issue?: string | null;
  evidence?: string;
};

type RunLinkageResponse = {
  planningDate: string;
  runs: number;
  stops: number;
  siteNameUnresolved: number;
  siteMatchedButGeofenceUnlinked: number;
  linkedStops: number;
  stopsWithVisitEvidence: number;
  issues: RunLinkageIssue[];
  records: RunLinkageIssue[];
};

type Site = {
  id: string;
  externalCode?: string;
  name?: string;
  driverTextName?: string;
  aliases?: string;
  active?: boolean;
};

type SiteGeofenceStatus = {
  siteId: string;
  siteCode: string;
  siteName: string;
  linkedGeofences: string[];
  geofenceLinked: boolean;
  needsReview: boolean;
};

export type SiteCoverage = {
  sourceLabel: string;
  state: "linked" | "unlinked" | "unresolved";
  siteCode?: string;
  siteName?: string;
  geofenceName?: string;
  action?: string;
};

function normalise(value?: string) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function splitAliases(value?: string) {
  return String(value || "").split(/[,;|\n\r]+/).map(item => item.trim()).filter(Boolean);
}

function variants(value: string) {
  const values = new Set<string>();
  const add = (candidate?: string) => { if (candidate?.trim()) values.add(candidate.trim()); };
  add(value);
  add(value.replace(/^\s*(collect|deliver)\s*[·:-]\s*/i, ""));
  for (const candidate of [...values]) {
    add(candidate.replace(/\(\s*[+-]?\d+(?:\.\d+)?\s*°?\s*C\s*\)/gi, "").trim());
    add(candidate.replace(/\s+(CHILL|FRV)$/i, "").trim());
    const separator = candidate.indexOf("-");
    if (separator > 0) {
      const prefix = candidate.slice(0, separator).trim().toUpperCase();
      if (["BAR", "BARFOOTS", "LAN", "LANGMEADS", "SB", "GHS", "SLH", "NWF", "WAITROSE", "MORRISONS", "ALDI"].includes(prefix)) {
        add(candidate.slice(separator + 1));
      }
    }
    const open = candidate.lastIndexOf("(");
    if (open > 0 && candidate.endsWith(")")) {
      const before = candidate.slice(0, open).trim();
      const inside = candidate.slice(open + 1, -1).trim();
      add(before);
      if (inside && !inside.includes("°")) add(inside);
    }
  }
  return [...values].map(normalise).filter(Boolean);
}

function siteCandidates(site: Site) {
  return [site.externalCode, site.name, site.driverTextName, ...splitAliases(site.aliases)]
    .map(normalise)
    .filter(Boolean);
}

function resolveLabel(label: string, sites: Site[], statuses: SiteGeofenceStatus[]): SiteCoverage {
  const keys = variants(label);
  const directMatches = sites.filter(site => site.active !== false && siteCandidates(site).some(candidate => keys.includes(candidate)));
  const unique = Array.from(new Map(directMatches.map(site => [site.id, site])).values());
  if (unique.length !== 1) {
    return {
      sourceLabel: label,
      state: "unresolved",
      action: unique.length > 1
        ? "More than one Site matches this wording. Remove duplicate/ambiguous aliases in Site CRM."
        : "Add this wording as an alias to the correct Site CRM record.",
    };
  }
  const site = unique[0];
  const status = statuses.find(item => item.siteId === site.id);
  if (!status?.geofenceLinked) {
    return {
      sourceLabel: label,
      state: "unlinked",
      siteCode: status?.siteCode || site.externalCode,
      siteName: status?.siteName || site.driverTextName || site.name,
      action: "Site is recognised but has no active geofence. Link the correct geofence in Site CRM / Geofence Integrity.",
    };
  }
  return {
    sourceLabel: label,
    state: "linked",
    siteCode: status.siteCode || site.externalCode,
    siteName: status.siteName || site.driverTextName || site.name,
    geofenceName: status.linkedGeofences.join(", "),
  };
}

export function useSiteGeofenceCoverage(labels: string[]) {
  const token = useAccessToken();
  const cleanLabels = useMemo(() => Array.from(new Set(labels.map(value => String(value || "").trim()).filter(Boolean))), [labels]);
  const key = cleanLabels.join("\u001f");
  const lookup = useApi(useCallback(async () => {
    if (!cleanLabels.length) return [] as SiteCoverage[];
    const access = await token();
    const [sites, statuses] = await Promise.all([
      request<Site[]>("/api/v1/sites", access),
      request<SiteGeofenceStatus[]>("/api/v1/site-geofence-sync/sites", access, { cache: "no-store" }),
    ]);
    return cleanLabels.map(label => resolveLabel(label, sites, statuses));
  // key intentionally represents the complete label set so edits/additions rerun the check.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token]));

  const byLabel = useMemo(() => new Map((lookup.data || []).map(item => [normalise(item.sourceLabel), item])), [lookup.data]);
  const resultFor = useCallback((label?: string) => label ? byLabel.get(normalise(label)) : undefined, [byLabel]);
  const issues = useMemo(() => (lookup.data || []).filter(item => item.state !== "linked"), [lookup.data]);
  return { ...lookup, resultFor, issues };
}

export function GeofenceStatusBadge({ result }: { result?: SiteCoverage }) {
  if (!result) return null;
  if (result.state === "linked") {
    return <small title={result.geofenceName || "Active geofence linked"} style={{ display: "block", marginTop: 4, color: "#18794e", fontWeight: 800 }}>● GEOFENCE LINKED</small>;
  }
  const unresolved = result.state === "unresolved";
  return <small title={result.action} style={{ display: "block", marginTop: 4, color: "#b42318", fontWeight: 900 }}>⚠ {unresolved ? "SITE NAME NOT RECOGNISED" : "GEOFENCE MISSING"}</small>;
}

export function SiteCoverageWarningPanel({ issues, title = "Geofence coverage needs attention" }: { issues: SiteCoverage[]; title?: string }) {
  if (!issues.length) return null;
  const unresolved = issues.filter(item => item.state === "unresolved").length;
  const unlinked = issues.filter(item => item.state === "unlinked").length;
  return <div className="notice" style={{ border: "2px solid #b42318", background: "#fff1f0", marginBottom: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
      <div>
        <strong style={{ color: "#b42318" }}>⚠ {title}</strong>
        <div style={{ marginTop: 5 }}>{unresolved} site name{unresolved === 1 ? "" : "s"} need an alias · {unlinked} recognised Site{unlinked === 1 ? "" : "s"} need a geofence link.</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className="button-like" to="/sites">Open Site CRM</Link>
        <Link className="button-like" to="/geofences">Geofence Integrity</Link>
      </div>
    </div>
    <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
      {issues.slice(0, 10).map((item, index) => <div key={`${item.sourceLabel}-${index}`}>
        <strong>{item.sourceLabel}</strong> — {item.state === "unresolved" ? "Site name not recognised" : `${item.siteCode || "Site"} · ${item.siteName || "Site recognised"} has no linked geofence`}. <span>{item.action}</span>
      </div>)}
      {issues.length > 10 && <small>+ {issues.length - 10} more location warning{issues.length - 10 === 1 ? "" : "s"}.</small>}
    </div>
  </div>;
}

export function RunGeofenceWarningPanel({ planningDate }: { planningDate: string }) {
  const token = useAccessToken();
  const check = useApi(useCallback(async () => request<RunLinkageResponse>(`/api/v1/planning/geofence-linkage?date=${encodeURIComponent(planningDate)}`, await token(), { cache: "no-store" }), [planningDate, token]));
  const issues = check.data?.issues || [];
  if (!check.loading && !check.error && !issues.length) return null;
  if (check.error) return <div className="notice" style={{ borderColor: "#b42318" }}>⚠ Geofence coverage check could not be loaded. Runs remain available, but Site/geofence linkage has not been confirmed.</div>;
  if (!issues.length) return null;
  return <div className="notice" style={{ border: "2px solid #b42318", background: "#fff1f0", marginBottom: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
      <div>
        <strong style={{ color: "#b42318" }}>⚠ RUN GEOFENCE COVERAGE — {issues.length} STOP{issues.length === 1 ? "" : "S"} NEED ACTION</strong>
        <div style={{ marginTop: 5 }}>{check.data?.siteNameUnresolved || 0} site name{check.data?.siteNameUnresolved === 1 ? "" : "s"} need an alias · {check.data?.siteMatchedButGeofenceUnlinked || 0} recognised Site{check.data?.siteMatchedButGeofenceUnlinked === 1 ? "" : "s"} need a geofence link.</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className="button-like" to="/sites">Fix Site aliases</Link>
        <Link className="button-like" to="/geofences">Link geofences</Link>
      </div>
    </div>
    <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
      {issues.slice(0, 12).map(issue => <div key={`${issue.loadId}-${issue.stopId}`}>
        <strong>{issue.run} · Stop {issue.sequence} · {issue.stopName.replace(/^Collect · |^Deliver · /i, "")}</strong> — {issue.issue === "SiteNameNotResolved"
          ? "Site name not recognised. Add this wording to the correct Site's aliases."
          : `${issue.siteCode || "Site"} · ${issue.siteName || "Site recognised"} has no active linked geofence.`}
      </div>)}
      {issues.length > 12 && <small>+ {issues.length - 12} more affected run stop{issues.length - 12 === 1 ? "" : "s"}.</small>}
    </div>
  </div>;
}
