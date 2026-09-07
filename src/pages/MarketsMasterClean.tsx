import { useCallback, useMemo, useState, type FormEvent } from "react";
import { api, type MarketContact } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

const ALL_MARKETS = "__all__";
const preferredMarkets = ["Covent", "Spit", "Western", "Sender"];

function clean(value?: string) { return String(value || "").trim(); }
function normal(value?: string) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function inferredStand(contact: MarketContact) {
  if (clean(contact.standOrLocation)) return clean(contact.standOrLocation);
  const name = clean(contact.name);
  return name.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() || name.match(/\b(?:stall|stand)\s*#?\s*([a-z]?\d{1,4}[a-z]?)\s*$/i)?.[1]?.trim() || name.match(/\s((?:s)?\d{1,3}[a-z]?|[a-z]\d{1,3})\s*$/i)?.[1]?.trim() || "";
}

export function marketTabs(rows: MarketContact[]) {
  const discovered = Array.from(new Set(rows.map(row => clean(row.market)).filter(Boolean)));
  const extras = discovered.filter(market => !preferredMarkets.some(preferred => normal(preferred) === normal(market))).sort((left, right) => left.localeCompare(right));
  return [...preferredMarkets, ...extras];
}

export function marketRowsForTab(rows: MarketContact[], activeMarket: string) {
  if (activeMarket === ALL_MARKETS) return rows;
  return rows.filter(row => normal(row.market) === normal(activeMarket));
}

function marketTabLabel(market: string) { return market === "Sender" ? "Senders" : market; }

export function MarketsMasterClean() {
  const token = useAccessToken();
  const contacts = useApi(useCallback(async () => api.marketContacts(await token()), [token]));
  const [activeMarket, setActiveMarket] = useState(ALL_MARKETS);
  const rows = contacts.data || [];
  const tabs = useMemo(() => marketTabs(rows), [rows]);
  const visibleRows = useMemo(() => marketRowsForTab(rows, activeMarket), [rows, activeMarket]);
  const summary = useMemo(() => {
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
  }, [rows]);

  return <div className="market-clean-wrapper">
    <section className="panel" style={{ marginBottom: 18 }}>
      <p className="eyebrow">Market master quality</p>
      <h2>{summary.blocking} blocking validation issue{summary.blocking === 1 ? "" : "s"}</h2>
      <p>{summary.total} market records checked. Missing stall/stand and salesman details are tracked as advisory completion gaps rather than each being counted as a broken record.</p>
      <div className="metrics">
        <span><strong>{summary.missingRequired}</strong> missing market/name</span>
        <span><strong>{summary.duplicateGroups}</strong> exact duplicate groups</span>
        <span><strong>{summary.missingStand}</strong> stall/stand to enrich</span>
        <span><strong>{summary.missingSalesman}</strong> salesman to enrich</span>
      </div>
      {contacts.error && <p className="notice inline-notice">Market quality check: {contacts.error}</p>}
    </section>

    <section>
      <div className="title-row">
        <div><p className="eyebrow">Master data</p><h1>Markets &amp; senders</h1></div>
        <button onClick={() => void contacts.refresh()}>Refresh</button>
      </div>
      <p className="intro">Market orders use this list for sellers, stall details, salesman and sender dropdowns. Choose a market below to work with one list at a time.</p>

      <div className="market-subtabs" role="tablist" aria-label="Markets">
        <button type="button" role="tab" aria-selected={activeMarket === ALL_MARKETS} className={activeMarket === ALL_MARKETS ? "primary" : ""} onClick={() => setActiveMarket(ALL_MARKETS)}>All Markets <span>{rows.length}</span></button>
        {tabs.map(market => {
          const count = marketRowsForTab(rows, market).length;
          return <button type="button" role="tab" aria-selected={activeMarket === market} className={activeMarket === market ? "primary" : ""} key={market} onClick={() => setActiveMarket(market)}>{marketTabLabel(market)} <span>{count}</span></button>;
        })}
      </div>

      {contacts.loading && <div className="state">Loading market records…</div>}
      {!contacts.loading && contacts.error && <div className="state error">{contacts.error}</div>}
      {!contacts.loading && !contacts.error && visibleRows.length === 0 && <div className="state">No records are available for this market.</div>}
      {!contacts.loading && !contacts.error && visibleRows.length > 0 && <div className="master-table-wrap">
        <table className="master-table">
          <thead><tr>{activeMarket === ALL_MARKETS && <th>Market</th>}<th>{activeMarket === "Sender" ? "Sender" : "Seller / sender"}</th><th>Stall / stand</th><th>Salesman</th><th>Sender</th><th>Active</th></tr></thead>
          <tbody>{visibleRows.map(row => <tr key={row.id}>{activeMarket === ALL_MARKETS && <td>{row.market}</td>}<td>{row.name || "—"}</td><td>{row.standOrLocation || "—"}</td><td>{row.salesman || "—"}</td><td>{row.sender || "—"}</td><td>{row.active ? "Yes" : "No"}</td></tr>)}</tbody>
        </table>
      </div>}

      <MarketQuickAdd onSaved={contacts.refresh} />
    </section>
    <style>{`.market-subtabs{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px}.market-subtabs button{display:inline-flex;align-items:center;gap:7px}.market-subtabs button span{opacity:.72;font-size:.85em}`}</style>
  </div>;
}

function MarketQuickAdd({ onSaved }: { onSaved: () => void }) {
  const token = useAccessToken();
  const [form, setForm] = useState({ market: "Covent", name: "", standOrLocation: "", salesman: "", sender: "" });
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const update = (name: keyof typeof form, value: string) => setForm(current => ({ ...current, [name]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      await api.stageRecord("marketcontact", { ...form, active: true }, `web-market:${form.market}:${form.name}`, await token());
      setMessage("Market record sent to staging review.");
      setForm(current => ({ market: current.market, name: "", standOrLocation: "", salesman: "", sender: "" }));
      onSaved();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "Market record could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="quick-order master-edit-form" onSubmit={event => void submit(event)}>
    <h2>Add market seller or sender</h2>
    <p className="hint">This is the single place to add an individual market record. Bulk workbook imports remain available from the main Master Data import area.</p>
    <div className="field-grid">
      <label>Market<select value={form.market} onChange={event => update("market", event.target.value)}><option>Covent</option><option>Spit</option><option>Western</option><option>Sender</option></select></label>
      <label>{form.market === "Sender" ? "Sender" : "Seller"}<input required value={form.name} onChange={event => update("name", event.target.value)} /></label>
      <label>Stall / stand<input value={form.standOrLocation} onChange={event => update("standOrLocation", event.target.value)} /></label>
      <label>Salesman<input value={form.salesman} onChange={event => update("salesman", event.target.value)} /></label>
      <label>Sender<input value={form.sender} onChange={event => update("sender", event.target.value)} /></label>
    </div>
    <button className="primary" disabled={saving}>{saving ? "Saving…" : "Send for review"}</button>
    {message && <p className="hint">{message}</p>}
  </form>;
}
