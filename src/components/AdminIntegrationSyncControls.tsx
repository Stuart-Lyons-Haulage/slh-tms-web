import { useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type SyncResult = { provider: string; success: boolean; completedAtUtc: string; message: string };

type SystemState = {
  status: string;
  lastPlatformUpdateUtc?: string;
  schedules: { dot: string; tachoMaster: string; sageHr: string; fleetio: string };
  providers: Array<{ name: string; configured: boolean; state: string; lastUpdatedUtc?: string; ageMinutes?: number }>;
};

export function AdminIntegrationSyncControls() {
  const token = useAccessToken();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [state, setState] = useState<SystemState>();

  const loadState = async () => {
    try { setState(await request<SystemState>('/api/v1/system-sync/state', await token())); }
    catch { /* Existing admin integration cards remain available. */ }
  };

  const force = async (provider: 'tacho' | 'sage' | 'fleetio' | 'all') => {
    setBusy(provider);
    setMessage(undefined);
    try {
      const result = await request<SyncResult | SyncResult[]>(`/api/v1/system-sync/force/${provider}`, await token(), { method: 'POST' }, 120000);
      const rows = Array.isArray(result) ? result : [result];
      setMessage(rows.map(item => `${item.provider}: ${item.message}`).join(' · '));
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Force refresh failed.');
    } finally {
      setBusy(undefined);
    }
  };

  return <section className="panel" style={{ marginBottom: 18 }}>
    <div className="title-row">
      <div>
        <p className="eyebrow">Admin recovery only</p>
        <h2>Integration synchronisation</h2>
        <p className="hint">Normal updates are automatic. Use these controls only when you deliberately need to force a provider refresh.</p>
      </div>
      <button onClick={() => void loadState()}>Check system state</button>
    </div>
    <div className="actions" style={{ flexWrap: 'wrap' }}>
      <button onClick={() => void force('tacho')} disabled={Boolean(busy)}>{busy === 'tacho' ? 'Refreshing…' : 'Force TachoMaster'}</button>
      <button onClick={() => void force('sage')} disabled={Boolean(busy)}>{busy === 'sage' ? 'Refreshing…' : 'Force Sage HR'}</button>
      <button onClick={() => void force('fleetio')} disabled={Boolean(busy)}>{busy === 'fleetio' ? 'Refreshing…' : 'Force Fleetio'}</button>
      <button className="primary" onClick={() => void force('all')} disabled={Boolean(busy)}>{busy === 'all' ? 'Refreshing all…' : 'Force refresh all systems'}</button>
    </div>
    <p className="hint">Automatic cadence: TachoMaster every 5 minutes · Sage HR 05:30 UK daily · Fleetio hourly · DOT/Falcon continuous.</p>
    {state && <p className="hint">Platform state: <strong>{state.status}</strong>{state.lastPlatformUpdateUtc ? ` · last update ${new Date(state.lastPlatformUpdateUtc).toLocaleString('en-GB')}` : ''}</p>}
    {message && <p className="notice inline-notice">{message}</p>}
  </section>;
}
