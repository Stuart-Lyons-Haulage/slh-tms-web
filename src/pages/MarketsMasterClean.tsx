import { useCallback, useMemo } from "react";
import { MarketsMaster } from "./Pages";
import { api, type MarketContact } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

function clean(value?: string) { return String(value || "").trim(); }
function normal(value?: string) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function inferredStand(contact: MarketContact) {
  if (clean(contact.standOrLocation)) return clean(contact.standOrLocation);
  const name = clean(contact.name);
  return name.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() || name.match(/\b(?:stall|stand)\s*#?\s*([a-z]?\d{1,4}[a-z]?)\s*$/i)?.[1]?.trim() || name.match(/\s((?:s)?\d{1,3}[a-z]?|[a-z]\d{1,3})\s*$/i)?.[1]?.trim() || "";
}

export function MarketsMasterClean() {
  const token = useAccessToken();
  const contacts = useApi(useCallback(async () => api.marketContacts(await token()), [token]));
  const summary = useMemo(() => {
    const rows = contacts.data || [];
    const missingRequired = rows.filter(row => !clean(row.market) || !clean(row.name)).length;
    const duplicateGroups = Object.values(rows.reduce<Record<string, MarketContact[]>>((groups, row) => {
      if (!clean(row.market) || !clean(row.name)) return groups;
      const key = `${normal(row.market)}|${normal(row.name)}|${normal(inferredStand(row))}`;
      (groups[key] ||= []).push(row);
      return groups;
    }, {})).filter(group => group.length > 1).length;
    const missingStand = rows.filter(row => clean(row.market).toLowerCase() !== "sender" && !inferredStand(row)).length;
    const missingSalesman = rows.filter(row => clean(row.market).toLowerCase() !== "sender" && !clean(row.salesman)).length;
    return { total: rows.length, blocking: missingRequired + duplicateGroups, missingRequired, duplicateGroups, missingStand, missingSalesman };
  }, [contacts.data]);

  return <div className="market-clean-wrapper">
    <section className="panel" style={{ marginBottom: 18 }}>
      <p className="eyebrow">Market master quality</p>
      <h2>{summary.blocking} blocking validation issue{summary.blocking === 1 ? "" : "s"}</h2>
      <p>{summary.total} market records checked. Missing stall/stand and salesman details are now tracked as advisory completion gaps rather than each being counted as a broken record.</p>
      <div className="metrics">
        <span><strong>{summary.missingRequired}</strong> missing market/name</span>
        <span><strong>{summary.duplicateGroups}</strong> exact duplicate groups</span>
        <span><strong>{summary.missingStand}</strong> stall/stand to enrich</span>
        <span><strong>{summary.missingSalesman}</strong> salesman to enrich</span>
      </div>
      {contacts.error && <p className="notice inline-notice">Market quality check: {contacts.error}</p>}
    </section>
    <style>{`.market-clean-wrapper > section:not(:first-of-type) .master-validation{display:none!important}`}</style>
    <MarketsMaster />
  </div>;
}
