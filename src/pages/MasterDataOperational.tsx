import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

export type MasterDataTab = 'drivers' | 'vehicles' | 'trailers' | 'sites' | 'geofences' | 'customers';
type Row = Record<string, unknown> & { id: string; active: boolean };
type Audit = { id: string; entityType: string; entityId: string; action: string; changesJson?: string; changedBy?: string; changedAtUtc: string };

const config: Record<MasterDataTab, { title: string; search: string; entityType: string; columns: Array<[string, string]>; editable: Array<[string, string, 'text' | 'number' | 'checkbox' | 'textarea']> }> = {
  drivers: { title: 'Drivers', search: 'Name, employee number or Tacho name', entityType: 'Driver', columns: [['displayName','Driver'],['employeeNumber','Employee'],['tachoName','Tacho name'],['driverType','Type'],['driverGroup','Group']], editable: [['displayName','Driver name','text'],['employeeNumber','Employee number','text'],['tachoName','Tacho name','text'],['mobileNumber','Mobile','text'],['driverType','Driver type','text'],['driverGroup','Driver group','text'],['skills','Skills','textarea']] },
  vehicles: { title: 'Vehicles', search: 'Registration, last 3, fleet number or abbreviation', entityType: 'Vehicle', columns: [['registration','Registration'],['fleetNumber','Fleet no.'],['abbreviation','Short code'],['transmission','Transmission'],['fleetioStatus','Fleetio']], editable: [['registration','Registration','text'],['fleetNumber','Fleet number','text'],['abbreviation','Abbreviation / last 3','text'],['transmission','Transmission','text'],['cabMobile','Cab mobile','text'],['fleetioId','Fleetio ID','text'],['fleetioName','Fleetio name','text'],['notes','Notes','textarea']] },
  trailers: { title: 'Trailers', search: 'Trailer number or type', entityType: 'Trailer', columns: [['trailerNumber','Trailer'],['type','Type'],['standardCapacity','Standard capacity'],['euroCapacity','Euro capacity']], editable: [['trailerNumber','Trailer number','text'],['type','Type','text'],['standardCapacity','Standard capacity','number'],['euroCapacity','Euro capacity','number']] },
  sites: { title: 'Sites', search: 'Site name, code, postcode or driver text name', entityType: 'Site', columns: [['name','Site'],['externalCode','Code'],['driverTextName','Driver text'],['collectionAddress','Address / postcode']], editable: [['externalCode','External code','text'],['name','Site name','text'],['driverTextName','Driver text name','text'],['collectionAddress','Address / postcode','textarea'],['collectionInstructions','Collection instructions','textarea'],['mapLink','Map link','text']] },
  geofences: { title: 'Geofences', search: 'Geofence name, site number or category', entityType: 'Geofence', columns: [['name','Geofence'],['siteNumber','Site no.'],['category','Category'],['maxWaitMinutes','Max wait'],['pendingEntryMinutes','Entry confirm']], editable: [['name','Name','text'],['siteNumber','Site number','text'],['category','Category','text'],['categoryMaxWaitMinutes','Category max wait (min)','number'],['maxWaitMinutes','Max wait (min)','number'],['pendingEntryMinutes','Entry confirm (min)','number'],['pendingExitMinutes','Exit confirm (min)','number'],['polygonJson','Polygon JSON','textarea']] },
  customers: { title: 'Customers', search: 'Customer name or code', entityType: 'Customer', columns: [['name','Customer'],['code','Code']], editable: [['code','Customer code','text'],['name','Customer name','text']] },
};

function fmt(value: unknown) { if (value == null || value === '') return '—'; if (typeof value === 'boolean') return value ? 'Yes' : 'No'; return String(value); }
function isoDate(value?: string) { return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function matchesQuery(row: Row, query: string) { const value = query.trim().toLowerCase(); if (!value) return true; return Object.values(row).some(item => item != null && String(item).toLowerCase().includes(value)); }

export function MasterDataOperational({ initialTab = 'drivers', showCategoryButtons = true, showHeading = true }: { initialTab?: MasterDataTab; showCategoryButtons?: boolean; showHeading?: boolean }) {
  const token = useAccessToken();
  const [tab, setTab] = useState<MasterDataTab>(initialTab); const [query, setQuery] = useState(''); const [includeInactive, setIncludeInactive] = useState(false);
  const [rows, setRows] = useState<Row[]>([]); const [selected, setSelected] = useState<Row>(); const [draft, setDraft] = useState<Record<string, unknown>>({}); const [audit, setAudit] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState<string>(); const [notice, setNotice] = useState<string>();
  const editorRef = useRef<HTMLDivElement>(null);
  const current = config[tab]; const endpoint = `/api/v1/operational-master-data/${tab}`;

  useEffect(() => { setTab(initialTab); }, [initialTab]);
  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const access = await token(); const params = new URLSearchParams({ includeInactive: String(includeInactive) }); if (query.trim()) params.set('q', query.trim());
      try { setRows(await request<Row[]>(`${endpoint}/search?${params}`, access)); }
      catch { const fallback = await request<Row[]>(`/api/v1/${tab}`, access); setRows(fallback.filter(row => (includeInactive || row.active !== false) && matchesQuery(row, query))); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load master data.'); } finally { setLoading(false); }
  }, [endpoint, includeInactive, query, tab, token]);
  useEffect(() => { const handle = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(handle); }, [load]);
  useEffect(() => { setSelected(undefined); setDraft({}); setAudit([]); setQuery(''); }, [tab]);

  const openEdit = async (row: Row) => {
    setSelected(row); setDraft({ ...row }); setAudit([]); setError(undefined); setNotice(undefined);
    window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    try { const access = await token(); setAudit(await request<Audit[]>(`/api/v1/operational-master-data/audit/${current.entityType}/${row.id}`, access)); } catch { /* history optional */ }
  };
  const save = async () => {
    if (!selected) return; setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const access = await token();
      try { await request(`${endpoint}/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); }
      catch { await request(`/api/v1/${tab}/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); }
      setNotice(`${current.entityType} updated in the Live TMS Master Database.`); setSelected(undefined); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed.'); } finally { setSaving(false); }
  };
  const setActive = async (row: Row, active: boolean) => {
    if (!window.confirm(`${active ? 'Restore' : 'Archive'} this ${current.entityType.toLowerCase()}? Historical planning records will be retained.`)) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try { const access = await token(); await request(`${endpoint}/${row.id}/${active ? 'restore' : 'archive'}`, access, { method: 'POST' }); setNotice(`${current.entityType} ${active ? 'restored' : 'archived'}.`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Archive/restore is not available until the latest master-data API deployment is live.'); } finally { setSaving(false); }
  };
  const tabs = useMemo(() => Object.keys(config) as MasterDataTab[], []);

  return <section>
    {showHeading && <div className="title-row"><div><p className="eyebrow">Master data control</p><h1>Edit, archive and audit master data</h1><p>Operational changes use the same live master records as planning. Records are archived rather than deleted.</p></div></div>}
    {showCategoryButtons && <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{tabs.map(key => <button key={key} className={tab === key ? 'primary' : ''} onClick={() => setTab(key)}>{config[key].title}</button>)}</div>}

    {selected && <div className="panel" ref={editorRef} style={{ scrollMarginTop: 90 }}>
      <div className="title-row"><div><p className="eyebrow">Edit {current.entityType}</p><h2>{fmt(selected[current.columns[0][0]])}</h2>{tab === 'sites' && <p className="hint">For routing, make sure the UK postcode is present in Address / postcode. The TMS will use the postcode first for location and ETA calculations.</p>}</div><button onClick={() => setSelected(undefined)}>Close</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
        {current.editable.map(([key,label,type]) => <label key={key}>{label}{type === 'textarea' ? <textarea rows={3} value={String(draft[key] ?? '')} onChange={e => setDraft(v => ({...v,[key]:e.target.value}))} /> : type === 'checkbox' ? <input type="checkbox" checked={Boolean(draft[key])} onChange={e => setDraft(v => ({...v,[key]:e.target.checked}))} /> : <input type={type} value={String(draft[key] ?? '')} onChange={e => setDraft(v => ({...v,[key]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value}))} />}</label>)}
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button><button disabled={saving} onClick={() => setSelected(undefined)}>Cancel</button></div>
      <hr/><h3>Change history</h3>{audit.length ? <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Date</th><th>Action</th><th>Changed by</th></tr></thead><tbody>{audit.map(item => <tr key={item.id}><td>{isoDate(item.changedAtUtc)}</td><td>{item.action}</td><td>{item.changedBy || '—'}</td></tr>)}</tbody></table></div> : <p className="hint">No recorded changes yet.</p>}
    </div>}

    <div className="panel"><div className="title-row"><div><h2>{current.title}</h2><small>{rows.length} record{rows.length === 1 ? '' : 's'} shown</small></div><div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}><label>Search<input value={query} onChange={e => setQuery(e.target.value)} placeholder={current.search}/></label><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)}/> Include archived</label><button onClick={() => void load()} disabled={loading}>Refresh</button></div></div>
      {error && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}{notice && <p className="notice">{notice}</p>}
      {loading ? <div className="state">Loading {current.title.toLowerCase()}…</div> : <div style={{ overflowX: 'auto' }}><table><thead><tr>{current.columns.map(([,label]) => <th key={label}>{label}</th>)}<th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>{current.columns.map(([key]) => <td key={key}>{fmt(row[key])}</td>)}<td>{row.active ? 'Active' : 'Archived'}</td><td style={{ whiteSpace: 'nowrap' }}><button onClick={() => void openEdit(row)}>Edit</button>{' '}<button onClick={() => void setActive(row, !row.active)} disabled={saving}>{row.active ? 'Archive' : 'Restore'}</button></td></tr>)}</tbody></table>{rows.length === 0 && <div className="state">No records match this search.</div>}</div>}
    </div>
  </section>;
}
