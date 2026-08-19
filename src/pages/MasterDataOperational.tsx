import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

export type MasterDataTab = 'drivers' | 'vehicles' | 'trailers' | 'sites' | 'geofences' | 'customers';
type Row = Record<string, unknown> & { id: string; active: boolean };
type Audit = { id: string; entityType: string; entityId: string; action: string; changesJson?: string; changedBy?: string; changedAtUtc: string };
type SitePlanningProfile = { siteId: string; externalCode: string; name: string; collectionAddress?: string; defaultTemperatureC?: number; region: string; source: string };
type EditType = 'text' | 'number' | 'checkbox' | 'textarea' | 'region';

const regions = ['North', 'Midlands', 'East', 'London', 'South East', 'South West', 'West / Wales', 'Other'];

const config: Record<MasterDataTab, { title: string; search: string; entityType: string; columns: Array<[string, string]>; editable: Array<[string, string, EditType]> }> = {
  drivers: { title: 'Drivers', search: 'Name, employee number or Tacho name', entityType: 'Driver', columns: [['displayName','Driver'],['employeeNumber','Employee'],['tachoName','Tacho name'],['driverType','Type'],['driverGroup','Group']], editable: [['displayName','Driver name','text'],['employeeNumber','Employee number','text'],['tachoName','Tacho name','text'],['mobileNumber','Mobile','text'],['driverType','Driver type','text'],['driverGroup','Driver group','text'],['skills','Skills','textarea']] },
  vehicles: { title: 'Vehicles', search: 'Registration, last 3, fleet number or abbreviation', entityType: 'Vehicle', columns: [['registration','Registration'],['fleetNumber','Fleet no.'],['abbreviation','Short code'],['transmission','Transmission'],['fleetioStatus','Fleetio']], editable: [['registration','Registration','text'],['fleetNumber','Fleet number','text'],['abbreviation','Abbreviation / last 3','text'],['transmission','Transmission','text'],['cabMobile','Cab mobile','text'],['fleetioId','Fleetio ID','text'],['fleetioName','Fleetio name','text'],['notes','Notes','textarea']] },
  trailers: { title: 'Trailers', search: 'Trailer number or type', entityType: 'Trailer', columns: [['trailerNumber','Trailer'],['type','Type'],['standardCapacity','Standard capacity'],['euroCapacity','Euro capacity']], editable: [['trailerNumber','Trailer number','text'],['type','Type','text'],['standardCapacity','Standard capacity','number'],['euroCapacity','Euro capacity','number']] },
  sites: { title: 'Sites', search: 'Site name, code, postcode, region or driver text name', entityType: 'Site', columns: [['name','Site'],['externalCode','Code'],['driverTextName','Driver text'],['collectionAddress','Address / postcode'],['defaultTemperatureC','Default temp'],['region','Planning region']], editable: [['externalCode','External code','text'],['name','Site name','text'],['driverTextName','Driver text name','text'],['collectionAddress','Address / postcode','textarea'],['collectionInstructions','Collection instructions','textarea'],['mapLink','Map link','text'],['defaultTemperatureC','Default temperature °C','number'],['region','Planning region','region']] },
  geofences: { title: 'Geofences', search: 'Geofence name, site number or category', entityType: 'Geofence', columns: [['name','Geofence'],['siteNumber','Site no.'],['category','Category'],['maxWaitMinutes','Max wait'],['pendingEntryMinutes','Entry confirm']], editable: [['name','Name','text'],['siteNumber','Site number','text'],['category','Category','text'],['categoryMaxWaitMinutes','Category max wait (min)','number'],['maxWaitMinutes','Max wait (min)','number'],['pendingEntryMinutes','Entry confirm (min)','number'],['pendingExitMinutes','Exit confirm (min)','number'],['polygonJson','Polygon JSON','textarea']] },
  customers: { title: 'Customers', search: 'Customer name or code', entityType: 'Customer', columns: [['name','Customer'],['code','Code']], editable: [['code','Customer code','text'],['name','Customer name','text']] },
};

function fmt(value: unknown) { if (value == null || value === '') return '—'; if (typeof value === 'boolean') return value ? 'Yes' : 'No'; return String(value); }
function fmtCell(key: string, value: unknown) { if (key === 'defaultTemperatureC' && value != null && value !== '') { const temperature = Number(value); return `${temperature > 0 ? '+' : ''}${temperature}°C`; } return fmt(value); }
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
      const access = await token();
      if (tab === 'sites') {
        const [activeSites, profiles] = await Promise.all([
          request<Row[]>('/api/v1/sites', access),
          request<SitePlanningProfile[]>('/api/v1/site-planning-profiles', access),
        ]);
        let sourceSites = activeSites;
        if (includeInactive) {
          try {
            const archivedSearch = await request<Row[]>(`${endpoint}/search?includeInactive=true`, access);
            sourceSites = Array.from(new Map([...activeSites, ...archivedSearch].map(row => [row.id, row])).values());
          } catch { /* keep the complete active register if archived lookup is unavailable */ }
        }
        const profileBySite = new Map(profiles.map(profile => [profile.siteId, profile]));
        const merged = sourceSites.map(site => {
          const profile = profileBySite.get(site.id);
          return {
            ...site,
            defaultTemperatureC: profile?.defaultTemperatureC ?? null,
            region: profile?.region || 'Other',
            planningProfileSource: profile?.source || 'No planning profile',
          } as Row;
        });
        setRows(merged.filter(row => matchesQuery(row, query)).sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''))));
      } else {
        const params = new URLSearchParams({ includeInactive: String(includeInactive) }); if (query.trim()) params.set('q', query.trim());
        try { setRows(await request<Row[]>(`${endpoint}/search?${params}`, access)); }
        catch { const fallback = await request<Row[]>(`/api/v1/${tab}`, access); setRows(fallback.filter(row => (includeInactive || row.active !== false) && matchesQuery(row, query))); }
      }
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
      if (tab === 'sites') {
        const temperatureValue = draft.defaultTemperatureC == null || draft.defaultTemperatureC === '' ? null : Number(draft.defaultTemperatureC);
        if (temperatureValue != null && (!Number.isFinite(temperatureValue) || temperatureValue < -30 || temperatureValue > 30)) throw new Error('Default temperature must be between -30°C and +30°C, or left blank.');
        await request(`${endpoint}/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        await request(`/api/v1/site-planning-profiles/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultTemperatureC: temperatureValue, region: String(draft.region || 'Other') }) });
      } else {
        try { await request(`${endpoint}/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); }
        catch { await request(`/api/v1/${tab}/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); }
      }
      setNotice(tab === 'sites' ? 'Site details and planning profile updated together in the Live TMS Master Database.' : `${current.entityType} updated in the Live TMS Master Database.`); setSelected(undefined); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed.'); } finally { setSaving(false); }
  };

  const setActive = async (row: Row, active: boolean) => {
    if (!window.confirm(`${active ? 'Restore' : 'Archive'} this ${current.entityType.toLowerCase()}? ${active ? 'It will return to active master-data lists.' : 'It will be removed from normal planning selections but historical records will be retained.'}`)) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const access = await token();
      try { await request(`/api/v1/master-data-cleanup/${tab}/${row.id}/${active ? 'restore' : 'archive'}`, access, { method: 'POST' }); }
      catch { await request(`${endpoint}/${row.id}/${active ? 'restore' : 'archive'}`, access, { method: 'POST' }); }
      setNotice(`${current.entityType} ${active ? 'restored' : 'archived'}. ${active ? '' : 'If this is an unused duplicate, enable Include archived and use Delete to remove it permanently.'}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Archive/restore failed.'); } finally { setSaving(false); }
  };

  const deleteRecord = async (row: Row) => {
    if (row.active) { setError('Archive this record before deleting it.'); return; }
    const label = fmt(row[current.columns[0][0]]);
    if (!window.confirm(`Permanently delete ${current.entityType.toLowerCase()} “${label}” from the TMS master?\n\nUse Delete only for a duplicate or incorrect master record. If it is referenced by operational history, the TMS will block deletion and keep it archived.`)) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const access = await token();
      await request(`/api/v1/master-data-cleanup/${tab}/${row.id}`, access, { method: 'DELETE' });
      setNotice(`${current.entityType} permanently deleted from the TMS master.`);
      if (selected?.id === row.id) setSelected(undefined);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed. This record may be in use; leave it archived instead.'); }
    finally { setSaving(false); }
  };

  const tabs = useMemo(() => Object.keys(config) as MasterDataTab[], []);

  return <section>
    {showHeading && <div className="title-row"><div><p className="eyebrow">Master data control</p><h1>Edit, archive, delete and audit master data</h1><p>Archive records to remove them from normal planning. Archived records can be permanently deleted only when the TMS confirms they are unused.</p></div></div>}
    {showCategoryButtons && <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{tabs.map(key => <button key={key} className={tab === key ? 'primary' : ''} onClick={() => setTab(key)}>{config[key].title}</button>)}</div>}

    {selected && <div className="panel" ref={editorRef} style={{ scrollMarginTop: 90 }}>
      <div className="title-row"><div><p className="eyebrow">Edit {current.entityType}</p><h2>{fmt(selected[current.columns[0][0]])}</h2>{tab === 'sites' && <p className="hint">This is now the complete site record used by planning. Keep the UK postcode in Address / postcode; default temperature and planning region are saved from this same form.</p>}</div><button onClick={() => setSelected(undefined)}>Close</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
        {current.editable.map(([key,label,type]) => <label key={key}>{label}{type === 'textarea' ? <textarea rows={3} value={String(draft[key] ?? '')} onChange={e => setDraft(v => ({...v,[key]:e.target.value}))} /> : type === 'checkbox' ? <input type="checkbox" checked={Boolean(draft[key])} onChange={e => setDraft(v => ({...v,[key]:e.target.checked}))} /> : type === 'region' ? <select value={String(draft[key] ?? 'Other')} onChange={e => setDraft(v => ({...v,[key]:e.target.value}))}>{regions.map(item => <option key={item}>{item}</option>)}</select> : <input type={type} step={key === 'defaultTemperatureC' ? '0.5' : undefined} value={String(draft[key] ?? '')} onChange={e => setDraft(v => ({...v,[key]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value}))} />}</label>)}
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : tab === 'sites' ? 'Save complete site' : 'Save changes'}</button><button disabled={saving} onClick={() => setSelected(undefined)}>Cancel</button></div>
      <hr/><h3>Change history</h3>{audit.length ? <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Date</th><th>Action</th><th>Changed by</th></tr></thead><tbody>{audit.map(item => <tr key={item.id}><td>{isoDate(item.changedAtUtc)}</td><td>{item.action}</td><td>{item.changedBy || '—'}</td></tr>)}</tbody></table></div> : <p className="hint">No recorded changes yet.</p>}
    </div>}

    <div className="panel"><div className="title-row"><div><h2>{current.title}</h2><small>{rows.length} record{rows.length === 1 ? '' : 's'} shown</small><p className="hint">{tab === 'sites' ? 'All active sites are shown here with each planning profile merged into the same record. Search covers site details, postcode, temperature and region.' : 'For duplicates: Archive first. Turn on Include archived, then Delete the unused duplicate. Records with operational history are protected from permanent deletion.'}</p></div><div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}><label>Search<input value={query} onChange={e => setQuery(e.target.value)} placeholder={current.search}/></label><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)}/> Include archived</label><button onClick={() => void load()} disabled={loading}>Refresh</button></div></div>
      {error && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}{notice && <p className="notice">{notice}</p>}
      {loading ? <div className="state">Loading {current.title.toLowerCase()}…</div> : <div style={{ overflowX: 'auto' }}><table><thead><tr>{current.columns.map(([,label]) => <th key={label}>{label}</th>)}<th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>{current.columns.map(([key]) => <td key={key}>{fmtCell(key, row[key])}</td>)}<td>{row.active ? 'Active' : 'Archived'}</td><td style={{ whiteSpace: 'nowrap' }}><button onClick={() => void openEdit(row)}>Edit</button>{' '}<button onClick={() => void setActive(row, !row.active)} disabled={saving}>{row.active ? 'Archive' : 'Restore'}</button>{!row.active && <>{' '}<button disabled={saving} onClick={() => void deleteRecord(row)} style={{ borderColor: '#b42318', color: '#b42318', fontWeight: 800 }}>Delete</button></>}</td></tr>)}</tbody></table>{rows.length === 0 && <div className="state">No records match this search.</div>}</div>}
    </div>
  </section>;
}
