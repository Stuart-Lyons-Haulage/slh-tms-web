import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { intelligenceApi } from '../lib/intelligenceApi';

const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

type SystemState = {
  status: 'current' | 'pending' | 'attention';
  generatedAtUtc: string;
  lastPlatformUpdateUtc?: string;
  displaySource: string;
};

const age = (value?: string) => {
  if (!value) return 'No data';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'now' : `${minutes}m`;
};

export function HeaderIntelligence() {
  const token = useAccessToken();
  const [count, setCount] = useState(0);
  const [system, setSystem] = useState<SystemState>();
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const access = await token();
        const [attention, state] = await Promise.all([
          intelligenceApi.attention(isoToday(), access),
          request<SystemState>('/api/v1/system-sync/state', access),
        ]);
        if (alive) { setCount(attention.count); setSystem(state); }
      } catch { /* Header remains usable if system state is temporarily unavailable. */ }
    };
    void refresh();
    // One lightweight platform-state refresh drives the top-right freshness display.
    const id = window.setInterval(refresh, 180000);
    return () => { alive = false; window.clearInterval(id); };
  }, [token]);
  return <div className="header-intelligence">
    <NavLink className={`attention-pill ${count ? 'has-attention' : ''}`} to="/attention">⚠ Needs attention <b>{count}</b></NavLink>
    {system && <div className="freshness-strip">
      <span className={`freshness ${system.status === 'current' ? 'ready' : system.status === 'attention' ? 'stale' : 'pending'}`} title={`${system.displaySource}. Last platform update ${system.lastPlatformUpdateUtc ? new Date(system.lastPlatformUpdateUtc).toLocaleString('en-GB') : 'unavailable'}`}>
        <i />TMS {system.status === 'current' ? 'current' : system.status} <b>{age(system.lastPlatformUpdateUtc)}</b>
      </span>
    </div>}
  </div>;
}
