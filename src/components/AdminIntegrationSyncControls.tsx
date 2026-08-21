import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type SyncResult = { provider: string; success: boolean; completedAtUtc: string; message: string };

type SystemState = {
  status: string;
  lastPlatformUpdateUtc?: string;
  schedules: { dot: string; tachoMaster: string; sageHr: string; fleetio: string };
  providers: Array<{ name: string; configured: boolean; state: string; lastUpdatedUtc?: string; ageMinutes?: number }>;
};

type RoadTechStatus = {
  configured: boolean;
  connected: boolean;
  recordCount: number;
  latestEventUtc?: string;
  missingSettings: string[];
  message: string;
};

function roadTechState(status: RoadTechStatus) {
  if (!status.configured) return { label: 'Setup incomplete', className: 'integration-state pending' };
  if (!status.connected && status.recordCount === 0) return { label: 'Configured · no live records', className: 'integration-state pending' };
  return { label: 'Connected', className: 'integration-state ready' };
}

export function AdminIntegrationSyncControls() {
  const token = useAccessToken();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [state, setState] = useState<SystemState>();
  const [roadTech, setRoadTech] = useState<RoadTechStatus>();
  const [roadTechError, setRoadTechError] = useState<string>();

  const loadState = async () => {
    setRoadTechError(undefined);
    try {
      const accessToken = await token();
      const [system, tracking] = await Promise.all([
        request<SystemState>('/api/v1/system-sync/state', accessToken),
        request<RoadTechStatus>('/api/v1/integrations/roadtech/status', accessToken),
      ]);
      setState(system);
      setRoadTech(tracking);
    } catch (error) {
      setRoadTechError(error instanceof Error ? error.message : 'RoadTech diagnostic check failed.');
    }
  };

  useEffect(() => { void loadState(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const trackingState = roadTech ? roadTechState(roadTech) : undefined;

  return <section className="panel" style={{ marginBottom: 18 }}>
    <div className="title-row">
      <div>
        <p className="eyebrow">Admin recovery only</p>
        <h2>Integration synchronisation</h2>
        <p className="hint">Normal updates are automatic. Use these controls only when you deliberately need to force a provider refresh.</p>
      </div>
      <button onClick={() => void loadState()}>Check system state</button>
    </div>

    <div className="admin-card" style={{ marginBottom: 14 }}>
      <div className="title-row" style={{ marginBottom: 8 }}>
        <div>
          <p className="eyebrow">RoadTech / DOT diagnostics</p>
          <h3>Tracking runtime status</h3>
        </div>
        {trackingState && <span className={trackingState.className}>{trackingState.label}</span>}
      </div>
      {!roadTech && !roadTechError && <p className="hint">Checking RoadTech runtime settings and live connectivity…</p>}
      {roadTech && <>
        <p>{roadTech.message}</p>
        {!roadTech.configured && roadTech.missingSettings.length > 0 && <div className="notice inline-notice">
          <strong>Specific settings to amend:</strong> {roadTech.missingSettings.join(' · ')}
        </div>}
        {roadTech.configured && !roadTech.connected && <div className="notice inline-notice">
          <strong>Configuration is present.</strong> RoadTech is not currently returning live vehicle records. This is a connectivity/credentials/provider-data issue rather than missing setup.
        </div>}
        {roadTech.connected && <p className="hint"><strong>{roadTech.recordCount}</strong> live RoadTech vehicle record{roadTech.recordCount === 1 ? '' : 's'} returned{roadTech.latestEventUtc ? ` · latest event ${new Date(roadTech.latestEventUtc).toLocaleString('en-GB')}` : ''}.</p>}
      </>}
      {roadTechError && <p className="notice inline-notice"><strong>Diagnostic request failed:</strong> {roadTechError}</p>}
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
