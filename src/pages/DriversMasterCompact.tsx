import { useCallback, useMemo, useState } from 'react';
import { api, request, type Driver } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { MasterDocuments } from '../components/MasterDocuments';

type Audit = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changedBy?: string;
  changedAtUtc: string;
};

type TachoRefreshResult = {
  message: string;
};

const columns: Array<{ key: keyof Driver; label: string }> = [
  { key: 'employeeNumber', label: 'Employee' },
  { key: 'displayName', label: 'Driver' },
  { key: 'mobileNumber', label: 'Mobile' },
  { key: 'driverType', label: 'Type' },
  { key: 'driverGroup', label: 'Group' },
  { key: 'skills', label: 'Skills' },
  { key: 'coding', label: 'Coding' },
  { key: 'northEligible', label: 'North' },
  { key: 'preloadEligible', label: 'Preload' },
  { key: 'tachoName', label: 'Tacho name' },
  { key: 'tachoCardNumber', label: 'Tacho card' },
  { key: 'tachoMasterDriverId', label: 'Tacho member' },
];

function value(input: unknown) {
  if (input == null || input === '') return '—';
  if (typeof input === 'boolean') return input ? 'Yes' : 'No';
  return String(input);
}

function auditDate(input: string) {
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input : parsed.toLocaleString('en-GB');
}

export function DriversMasterCompact() {
  const token = useAccessToken();
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Driver>();
  const [draft, setDraft] = useState<Driver>();
  const [audit, setAudit] = useState<Audit[]>([]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return drivers.data || [];
    return (drivers.data || []).filter(driver => columns.some(({ key }) => String(driver[key] ?? '').toLowerCase().includes(needle)));
  }, [drivers.data, query]);

  const edit = <K extends keyof Driver>(key: K, next: Driver[K]) => {
    setDraft(current => current ? { ...current, [key]: next } : current);
  };

  async function openDriver(driver: Driver) {
    setSelected(driver);
    setDraft({ ...driver });
    setAudit([]);
    setError(undefined);
    setMessage(undefined);
    try {
      const access = await token();
      setAudit(await request<Audit[]>(`/api/v1/operational-master-data/audit/Driver/${driver.id}`, access));
    } catch {
      // Audit history is useful but should never prevent the driver record from opening.
    }
  }

  function closeDriver() {
    if (saving) return;
    setSelected(undefined);
    setDraft(undefined);
    setAudit([]);
  }

  async function saveDriver() {
    if (!draft) return;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const { id, lastTachoSyncUtc: _lastSync, agencyName: _agency, ...payload } = draft;
      void _lastSync;
      void _agency;
      await api.updateDriver(id, payload, await token());
      setMessage(`${draft.displayName} updated.`);
      setSelected(undefined);
      setDraft(undefined);
      setAudit([]);
      await drivers.refresh();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Driver update failed.');
    } finally {
      setSaving(false);
    }
  }

  async function syncTacho() {
    setSyncing(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await request<TachoRefreshResult>(
        '/api/v1/operational-recovery/tachomaster/refresh-drivers',
        await token(),
        { method: 'POST' },
        60000,
      );
      setMessage(result.message);
      await drivers.refresh();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'TachoMaster sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  return <section className="drivers-unified-page">
    <div className="title-row">
      <div>
        <p className="eyebrow">Driver master</p>
        <h1>Drivers</h1>
        <p className="hint">One driver, one row. Click any driver to edit their master record and maintain their documents in the same popup.</p>
      </div>
      <div className="title-actions">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search driver…" aria-label="Search drivers" />
        <button onClick={() => void drivers.refresh()} disabled={drivers.loading}>Refresh</button>
        <button className="primary" onClick={() => void syncTacho()} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync TachoMaster'}</button>
      </div>
    </div>

    {message && <p className="notice inline-notice">{message}</p>}
    {error && <p className="notice inline-notice" style={{ borderColor: '#b42318' }}>{error}</p>}

    {drivers.error ? <div className="state error"><p>{drivers.error}</p></div> : drivers.loading && !drivers.data ? <div className="state">Loading drivers…</div> : <div className="master-table-wrap" style={{ overflowX: 'auto' }}>
      <table className="master-table driver-unified-table" style={{ minWidth: 1500 }}>
        <thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{visible.map(driver => <tr
          key={driver.id}
          className="crm-click-row"
          tabIndex={0}
          onClick={() => void openDriver(driver)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void openDriver(driver);
            }
          }}
          aria-label={`Open ${driver.displayName}`}
        >
          {columns.map(column => <td key={column.key}>{column.key === 'displayName' ? <strong>{value(driver[column.key])}</strong> : value(driver[column.key])}</td>)}
        </tr>)}</tbody>
      </table>
      {!drivers.loading && visible.length === 0 && <div className="state">No drivers match this search.</div>}
    </div>}
    <p className="hint">{visible.length} driver{visible.length === 1 ? '' : 's'} shown.</p>

    {selected && draft && <div
      className="crm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit driver ${selected.displayName}`}
      onMouseDown={event => { if (event.target === event.currentTarget) closeDriver(); }}
    >
      <div className="crm-modal">
        <div className="crm-modal-header">
          <div>
            <p className="eyebrow">Driver CRM record</p>
            <h2>{selected.displayName}</h2>
            <p className="hint">Edit this driver's operational master details and keep their controlled documents together in one record.</p>
          </div>
          <button type="button" onClick={closeDriver} disabled={saving}>Close</button>
        </div>

        <div className="crm-modal-body">
          <section>
            <h3>Core information</h3>
            <div className="crm-form-grid">
              <label>Employee<input value={draft.employeeNumber} onChange={event => edit('employeeNumber', event.target.value)} /></label>
              <label>Driver<input value={draft.displayName} onChange={event => edit('displayName', event.target.value)} /></label>
              <label>Mobile<input value={draft.mobileNumber || ''} onChange={event => edit('mobileNumber', event.target.value)} /></label>
              <label>Type<input value={draft.driverType || ''} onChange={event => edit('driverType', event.target.value)} /></label>
              <label>Group<input value={draft.driverGroup || ''} onChange={event => edit('driverGroup', event.target.value)} /></label>
              <label>Skills<textarea rows={3} value={draft.skills || ''} onChange={event => edit('skills', event.target.value)} /></label>
              <label>Coding<input value={draft.coding || ''} onChange={event => edit('coding', event.target.value)} /></label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={Boolean(draft.northEligible)} onChange={event => edit('northEligible', event.target.checked)} /> North</label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={Boolean(draft.preloadEligible)} onChange={event => edit('preloadEligible', event.target.checked)} /> Preload</label>
              <label>Tacho name<input value={draft.tachoName || ''} onChange={event => edit('tachoName', event.target.value)} /></label>
              <label>Tacho card<input value={draft.tachoCardNumber || ''} onChange={event => edit('tachoCardNumber', event.target.value)} /></label>
              <label>Tacho member<input value={draft.tachoMasterDriverId || ''} onChange={event => edit('tachoMasterDriverId', event.target.value)} /></label>
            </div>
            <p className="hint">Tacho card/member links may also be refreshed from TachoMaster by the Sync TachoMaster action.</p>
          </section>

          <section>
            <h3>Licence & notes</h3>
            <div className="crm-form-grid">
              <label>Licence no.<input value={draft.drivingLicenceNumber || ''} onChange={event => edit('drivingLicenceNumber', event.target.value)} /></label>
              <label>Licence expiry<input type="date" value={draft.licenceExpiry || ''} onChange={event => edit('licenceExpiry', event.target.value)} /></label>
              <label>Licence status<input value={draft.licenceStatus || ''} onChange={event => edit('licenceStatus', event.target.value)} /></label>
              <label style={{ gridColumn: '1 / -1' }}>Notes<textarea rows={3} value={draft.notes || ''} onChange={event => edit('notes', event.target.value)} /></label>
            </div>
          </section>

          <section>
            <h3>Audit</h3>
            {audit.length ? <div className="crm-audit-list">{audit.slice(0, 8).map(item => <article key={item.id}><strong>{item.action}</strong><span>{auditDate(item.changedAtUtc)}</span><small>{item.changedBy || '—'}</small></article>)}</div> : <p className="hint">No recorded changes yet.</p>}
          </section>

          <section className="crm-documents">
            <MasterDocuments entityType="Driver" entityId={selected.id} title={selected.displayName} />
          </section>
        </div>

        <div className="crm-modal-actions">
          <button className="primary" disabled={saving} onClick={() => void saveDriver()}>{saving ? 'Saving…' : 'Save driver record'}</button>
          <button disabled={saving} onClick={closeDriver}>Cancel</button>
        </div>
      </div>
    </div>}
  </section>;
}
