import { useCallback, useEffect, useMemo, useState } from 'react';
import { request, type Site } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { MasterDocuments } from '../components/MasterDocuments';

type SitePlanningProfile = {
  siteId: string;
  externalCode: string;
  name: string;
  defaultTemperatureC?: number | null;
  region?: string;
};

type Geofence = {
  id: string;
  name: string;
  category?: string | null;
  categoryMaxWaitMinutes?: number | null;
  maxWaitMinutes?: number | null;
  pendingEntryMinutes: number;
  pendingExitMinutes: number;
  siteNumber?: string | null;
  siteId?: string | null;
  polygonJson?: string | null;
  active: boolean;
};

type DraftSite = {
  name: string;
  driverTextName: string;
  aliases: string;
  collectionAddress: string;
  collectionInstructions: string;
  mapLink: string;
  notes: string;
  customField2: string;
  customField3: string;
  defaultTemperatureC: string;
  region: string;
};

type DraftFence = {
  id?: string;
  name: string;
  category: string;
  categoryMaxWaitMinutes: string;
  maxWaitMinutes: string;
  pendingEntryMinutes: string;
  pendingExitMinutes: string;
  polygonJson: string;
};

const regions = ['North', 'Midlands', 'East', 'London', 'South East', 'South West', 'West / Wales', 'Other'];

const clean = (value: unknown) => String(value ?? '').trim();
const normalise = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const numberOrNull = (value: string) => clean(value) === '' ? null : Number(value);

function linkedToSite(fence: Geofence, site: Site) {
  return fence.siteId === site.id || (!!fence.siteNumber && normalise(fence.siteNumber) === normalise(site.externalCode));
}

function siteDraft(site: Site, profile?: SitePlanningProfile): DraftSite {
  return {
    name: clean(site.name),
    driverTextName: clean(site.driverTextName),
    aliases: clean(site.aliases),
    collectionAddress: clean(site.collectionAddress),
    collectionInstructions: clean(site.collectionInstructions),
    mapLink: clean(site.mapLink),
    notes: clean(site.customField1),
    customField2: clean(site.customField2),
    customField3: clean(site.customField3),
    defaultTemperatureC: profile?.defaultTemperatureC == null ? '' : String(profile.defaultTemperatureC),
    region: clean(profile?.region || site.operationalRegion || 'Other') || 'Other',
  };
}

function fenceDraft(fence?: Geofence): DraftFence {
  return {
    id: fence?.id,
    name: clean(fence?.name),
    category: clean(fence?.category || 'Delivery'),
    categoryMaxWaitMinutes: fence?.categoryMaxWaitMinutes == null ? '' : String(fence.categoryMaxWaitMinutes),
    maxWaitMinutes: fence?.maxWaitMinutes == null ? '' : String(fence.maxWaitMinutes),
    pendingEntryMinutes: String(fence?.pendingEntryMinutes ?? 0),
    pendingExitMinutes: String(fence?.pendingExitMinutes ?? 0),
    polygonJson: clean(fence?.polygonJson || '[]'),
  };
}

export function SiteMasterUnified() {
  const token = useAccessToken();
  const [sites, setSites] = useState<Site[]>([]);
  const [profiles, setProfiles] = useState<SitePlanningProfile[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [query, setQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selected, setSelected] = useState<Site>();
  const [draft, setDraft] = useState<DraftSite>();
  const [fenceDraftState, setFenceDraftState] = useState<DraftFence>(() => fenceDraft());
  const [selectedFenceId, setSelectedFenceId] = useState('');
  const [existingFenceId, setExistingFenceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const access = await token();
      const [siteRows, profileRows, fenceRows] = await Promise.all([
        request<Site[]>(`/api/v1/operational-master-data/sites/search?includeInactive=${includeInactive}`, access),
        request<SitePlanningProfile[]>('/api/v1/site-planning-profiles', access),
        request<Geofence[]>('/api/v1/operational-master-data/geofences/search?includeInactive=true&take=5000', access),
      ]);
      // The Site table is authoritative: never render a second geofence/site register.
      setSites(Array.from(new Map(siteRows.map(site => [site.id, site])).values()));
      setProfiles(profileRows);
      setGeofences(fenceRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Site Master could not be loaded.');
    } finally { setLoading(false); }
  }, [includeInactive, token]);

  useEffect(() => { void load(); }, [load]);

  const profileBySite = useMemo(() => new Map(profiles.map(profile => [profile.siteId, profile])), [profiles]);
  const visibleSites = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sites
      .filter(site => !needle || [site.name, site.externalCode, site.driverTextName, site.aliases, site.collectionAddress, site.customField1, site.operationalRegion]
        .some(value => clean(value).toLowerCase().includes(needle)))
      .sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
  }, [query, sites]);

  const selectedFences = useMemo(() => selected ? geofences.filter(fence => linkedToSite(fence, selected) && fence.active) : [], [geofences, selected]);
  const availableFences = useMemo(() => selected ? geofences.filter(fence => fence.active && !linkedToSite(fence, selected) && !fence.siteId && normalise(fence.siteNumber) !== 'locationonly') : [], [geofences, selected]);

  function openSite(site: Site) {
    const profile = profileBySite.get(site.id);
    const linked = geofences.filter(fence => linkedToSite(fence, site) && fence.active);
    setSelected(site);
    setDraft(siteDraft(site, profile));
    setSelectedFenceId(linked[0]?.id || '');
    setFenceDraftState(fenceDraft(linked[0]));
    setExistingFenceId('');
    setMessage(undefined);
    setError(undefined);
  }

  function chooseFence(id: string) {
    setSelectedFenceId(id);
    setFenceDraftState(fenceDraft(geofences.find(fence => fence.id === id)));
  }

  async function saveSite() {
    if (!selected || !draft) return;
    const temperature = numberOrNull(draft.defaultTemperatureC);
    if (temperature != null && (!Number.isFinite(temperature) || temperature < -30 || temperature > 30)) {
      setError('Default temperature must be between -30°C and +30°C, or left blank.');
      return;
    }
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const access = await token();
      await request(`/api/v1/operational-master-data/sites/${selected.id}`, access, {
        method: 'PUT',
        body: JSON.stringify({
          externalCode: selected.externalCode,
          name: draft.name,
          driverTextName: draft.driverTextName || null,
          collectionAddress: draft.collectionAddress || null,
          collectionInstructions: draft.collectionInstructions || null,
          mapLink: draft.mapLink || null,
        }),
      });
      await request(`/api/v1/sites/${selected.id}/aliases`, access, {
        method: 'PUT',
        body: JSON.stringify({ aliases: draft.aliases || null }),
      });
      await request(`/api/v1/site-master-details/${selected.id}`, access, {
        method: 'PUT',
        body: JSON.stringify({ notes: draft.notes || null, customField2: draft.customField2 || null, customField3: draft.customField3 || null }),
      });
      await request(`/api/v1/site-planning-profiles/${selected.id}`, access, {
        method: 'PUT',
        body: JSON.stringify({ defaultTemperatureC: temperature, region: draft.region || 'Other' }),
      });
      setMessage('Site Master saved. Planner name, aliases, notes, instructions and planning profile now share this one canonical record.');
      window.dispatchEvent(new Event('slh:masterdata-changed'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Site could not be saved.');
    } finally { setSaving(false); }
  }

  async function saveFence(createNew = false) {
    if (!selected) return;
    const name = clean(fenceDraftState.name);
    if (!name) { setError('Geofence name is required.'); return; }
    let polygon: unknown;
    try { polygon = JSON.parse(fenceDraftState.polygonJson || '[]'); }
    catch { setError('Polygon JSON is not valid JSON.'); return; }
    if (!Array.isArray(polygon)) { setError('Polygon JSON must be an array of coordinate points.'); return; }

    const id = createNew || !fenceDraftState.id ? crypto.randomUUID() : fenceDraftState.id;
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const access = await token();
      await request(`/api/v1/operational-master-data/geofences/${id}`, access, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          category: clean(fenceDraftState.category) || null,
          categoryMaxWaitMinutes: numberOrNull(fenceDraftState.categoryMaxWaitMinutes),
          maxWaitMinutes: numberOrNull(fenceDraftState.maxWaitMinutes),
          pendingEntryMinutes: Math.max(0, Number(fenceDraftState.pendingEntryMinutes || 0)),
          pendingExitMinutes: Math.max(0, Number(fenceDraftState.pendingExitMinutes || 0)),
          siteNumber: selected.externalCode,
          siteId: selected.id,
          locationOnly: false,
          polygonJson: JSON.stringify(polygon),
        }),
      });
      setMessage(`${name} saved inside ${selected.name}.`);
      await load();
      setSelectedFenceId(id);
      setFenceDraftState(current => ({ ...current, id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Geofence could not be saved.');
    } finally { setSaving(false); }
  }

  async function linkExistingFence() {
    if (!selected || !existingFenceId) return;
    const fence = geofences.find(item => item.id === existingFenceId);
    if (!fence) return;
    setFenceDraftState(fenceDraft(fence));
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const access = await token();
      await request(`/api/v1/operational-master-data/geofences/${fence.id}`, access, {
        method: 'PUT',
        body: JSON.stringify({
          name: fence.name,
          category: fence.category,
          categoryMaxWaitMinutes: fence.categoryMaxWaitMinutes,
          maxWaitMinutes: fence.maxWaitMinutes,
          pendingEntryMinutes: fence.pendingEntryMinutes ?? 0,
          pendingExitMinutes: fence.pendingExitMinutes ?? 0,
          siteNumber: selected.externalCode,
          siteId: selected.id,
          locationOnly: false,
          polygonJson: fence.polygonJson || '[]',
        }),
      });
      setMessage(`${fence.name} linked to ${selected.name}.`);
      setExistingFenceId('');
      setSelectedFenceId(fence.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Geofence could not be linked.');
    } finally { setSaving(false); }
  }

  async function setActive(active: boolean) {
    if (!selected) return;
    if (!window.confirm(`${active ? 'Restore' : 'Archive'} ${selected.name}?`)) return;
    setSaving(true); setError(undefined);
    try {
      await request(`/api/v1/operational-master-data/sites/${selected.id}/${active ? 'restore' : 'archive'}`, await token(), { method: 'POST' });
      setMessage(active ? 'Site restored.' : 'Site archived.');
      setSelected(undefined);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Site status could not be changed.'); }
    finally { setSaving(false); }
  }

  return <section>
    <div className="panel">
      <div className="title-row">
        <div>
          <p className="eyebrow">Canonical Site Master</p>
          <h2>Sites</h2>
          <p className="hint">One row per Site. Click the row to maintain the planner name, aliases, notes, address, instructions, planning profile, documents and geofences together.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <label>Search<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Site, alias, code, postcode…" /></label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} /> Include archived</label>
          <button onClick={() => void load()} disabled={loading}>Refresh</button>
        </div>
      </div>
      {error && !selected && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}
      {loading ? <div className="state">Loading Site Master…</div> : <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Site</th><th>Code</th><th>Planner / driver name</th><th>Address</th><th>Geofence</th><th>Notes</th><th>Status</th></tr></thead>
          <tbody>{visibleSites.map(site => {
            const linked = geofences.filter(fence => linkedToSite(fence, site) && fence.active);
            return <tr key={site.id} className="crm-click-row" onClick={() => openSite(site)}>
              <td><strong>{site.name}</strong>{site.aliases && <small style={{ display: 'block' }}>{site.aliases}</small>}</td>
              <td>{site.externalCode}</td>
              <td>{site.driverTextName || site.name}</td>
              <td>{site.collectionAddress || '—'}</td>
              <td>{linked.length ? linked.map(fence => fence.name).join(', ') : <strong style={{ color: '#b42318' }}>Missing geofence</strong>}</td>
              <td>{site.customField1 || '—'}</td>
              <td>{site.active ? 'Active' : 'Archived'}</td>
            </tr>;
          })}</tbody>
        </table>
        {visibleSites.length === 0 && <div className="state">No Sites match this search.</div>}
      </div>}
    </div>

    {selected && draft && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Site Master ${selected.name}`} onMouseDown={event => { if (event.target === event.currentTarget) setSelected(undefined); }}>
      <div className="crm-modal" style={{ maxWidth: 1100 }}>
        <div className="crm-modal-header">
          <div><p className="eyebrow">One canonical Site record</p><h2>{selected.name}</h2><p className="hint">Code {selected.externalCode} · all planner/customer wording and physical execution data lives here.</p></div>
          <button onClick={() => setSelected(undefined)}>Close</button>
        </div>
        <div className="crm-modal-body">
          {message && <p className="notice">{message}</p>}
          {error && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}

          <section>
            <h3>Identity, aliases & notes</h3>
            <div className="crm-form-grid">
              <label>Canonical Site name<input value={draft.name} onChange={event => setDraft(current => current && ({ ...current, name: event.target.value }))} /></label>
              <label>Planner / driver name<input value={draft.driverTextName} onChange={event => setDraft(current => current && ({ ...current, driverTextName: event.target.value }))} /></label>
              <label style={{ gridColumn: '1 / -1' }}>Aliases<textarea rows={3} value={draft.aliases} onChange={event => setDraft(current => current && ({ ...current, aliases: event.target.value }))} placeholder="Customer wording, email wording, old names…" /></label>
              <label style={{ gridColumn: '1 / -1' }}>Notes<textarea rows={3} value={draft.notes} onChange={event => setDraft(current => current && ({ ...current, notes: event.target.value }))} /></label>
              <label>Additional reference 1<input value={draft.customField2} onChange={event => setDraft(current => current && ({ ...current, customField2: event.target.value }))} /></label>
              <label>Additional reference 2<input value={draft.customField3} onChange={event => setDraft(current => current && ({ ...current, customField3: event.target.value }))} /></label>
            </div>
          </section>

          <section>
            <h3>Address & operating instructions</h3>
            <div className="crm-form-grid">
              <label style={{ gridColumn: '1 / -1' }}>Address / postcode<textarea rows={2} value={draft.collectionAddress} onChange={event => setDraft(current => current && ({ ...current, collectionAddress: event.target.value }))} /></label>
              <label style={{ gridColumn: '1 / -1' }}>Collection / site instructions<textarea rows={3} value={draft.collectionInstructions} onChange={event => setDraft(current => current && ({ ...current, collectionInstructions: event.target.value }))} /></label>
              <label style={{ gridColumn: '1 / -1' }}>Map link<input value={draft.mapLink} onChange={event => setDraft(current => current && ({ ...current, mapLink: event.target.value }))} /></label>
            </div>
          </section>

          <section>
            <h3>Planning profile</h3>
            <div className="crm-form-grid">
              <label>Default temperature °C<input type="number" step="0.5" value={draft.defaultTemperatureC} onChange={event => setDraft(current => current && ({ ...current, defaultTemperatureC: event.target.value }))} /></label>
              <label>Region<select value={draft.region} onChange={event => setDraft(current => current && ({ ...current, region: event.target.value }))}>{regions.map(region => <option key={region}>{region}</option>)}</select></label>
            </div>
          </section>

          <section>
            <h3>Geofence</h3>
            <p className="hint">Geofences are children of this Site Master record. Link an existing Falcon/RoadTech polygon or create/edit one here; there is no second Site list.</p>
            {selectedFences.length > 0 && <label>Linked geofence<select value={selectedFenceId} onChange={event => chooseFence(event.target.value)}>{selectedFences.map(fence => <option key={fence.id} value={fence.id}>{fence.name}</option>)}</select></label>}
            {selectedFences.length === 0 && <p style={{ color: '#b42318', fontWeight: 800 }}>No active geofence is linked to this Site.</p>}

            <div className="crm-form-grid" style={{ marginTop: 12 }}>
              <label>Geofence name<input value={fenceDraftState.name} onChange={event => setFenceDraftState(current => ({ ...current, name: event.target.value }))} /></label>
              <label>Category<input value={fenceDraftState.category} onChange={event => setFenceDraftState(current => ({ ...current, category: event.target.value }))} /></label>
              <label>Category max wait (min)<input type="number" value={fenceDraftState.categoryMaxWaitMinutes} onChange={event => setFenceDraftState(current => ({ ...current, categoryMaxWaitMinutes: event.target.value }))} /></label>
              <label>Max wait (min)<input type="number" value={fenceDraftState.maxWaitMinutes} onChange={event => setFenceDraftState(current => ({ ...current, maxWaitMinutes: event.target.value }))} /></label>
              <label>Entry confirmation (min)<input type="number" min="0" value={fenceDraftState.pendingEntryMinutes} onChange={event => setFenceDraftState(current => ({ ...current, pendingEntryMinutes: event.target.value }))} /></label>
              <label>Exit confirmation (min)<input type="number" min="0" value={fenceDraftState.pendingExitMinutes} onChange={event => setFenceDraftState(current => ({ ...current, pendingExitMinutes: event.target.value }))} /></label>
              <label style={{ gridColumn: '1 / -1' }}>Polygon JSON<textarea rows={7} value={fenceDraftState.polygonJson} onChange={event => setFenceDraftState(current => ({ ...current, polygonJson: event.target.value }))} placeholder="[[longitude, latitude], ...]" /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {fenceDraftState.id && <button className="primary" disabled={saving} onClick={() => void saveFence(false)}>Save linked geofence</button>}
              <button disabled={saving} onClick={() => { setSelectedFenceId(''); setFenceDraftState(fenceDraft()); }}>New geofence</button>
              {!fenceDraftState.id && <button className="primary" disabled={saving} onClick={() => void saveFence(true)}>Create & link geofence</button>}
            </div>

            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) auto', gap: 8, alignItems: 'end' }}>
              <label>Link existing unassigned geofence<select value={existingFenceId} onChange={event => setExistingFenceId(event.target.value)}><option value="">Choose existing geofence…</option>{availableFences.map(fence => <option key={fence.id} value={fence.id}>{fence.name}</option>)}</select></label>
              <button disabled={saving || !existingFenceId} onClick={() => void linkExistingFence()}>Link to this Site</button>
            </div>
          </section>

          <section className="crm-documents"><MasterDocuments entityType="Site" entityId={selected.id} title={selected.name} /></section>
        </div>
        <div className="crm-modal-actions">
          <button className="primary" disabled={saving} onClick={() => void saveSite()}>{saving ? 'Saving…' : 'Save Site Master record'}</button>
          <button disabled={saving} onClick={() => void setActive(!selected.active)}>{selected.active ? 'Archive Site' : 'Restore Site'}</button>
          <button disabled={saving} onClick={() => setSelected(undefined)}>Close</button>
        </div>
      </div>
    </div>}
  </section>;
}
