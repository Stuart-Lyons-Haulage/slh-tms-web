import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAccessToken } from '../lib/auth';
import { intelligenceApi, type FreshnessSource } from '../lib/intelligenceApi';

const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const age = (source: FreshnessSource) => source.ageMinutes == null ? 'No data' : source.ageMinutes < 1 ? 'now' : `${Math.round(source.ageMinutes)}m`;

export function HeaderIntelligence() {
  const token = useAccessToken();
  const [count, setCount] = useState(0);
  const [sources, setSources] = useState<FreshnessSource[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const access = await token();
        const [attention, freshness] = await Promise.all([intelligenceApi.attention(isoToday(), access), intelligenceApi.freshness(access)]);
        if (alive) { setCount(attention.count); setSources(freshness.sources); }
      } catch { /* Header remains usable if intelligence is temporarily unavailable. */ }
    };
    void refresh();
    // Header intelligence is advisory rather than second-by-second operational data.
    // Three minutes keeps it useful while avoiding two API calls every minute on every open TMS screen.
    const id = window.setInterval(refresh, 180000);
    return () => { alive = false; window.clearInterval(id); };
  }, [token]);
  return <div className="header-intelligence">
    <NavLink className={`attention-pill ${count ? 'has-attention' : ''}`} to="/attention">⚠ Needs attention <b>{count}</b></NavLink>
    <div className="freshness-strip">{sources.map(source => <span key={source.name} className={`freshness ${source.state}`} title={source.lastUpdatedUtc ? `Last update ${new Date(source.lastUpdatedUtc).toLocaleString('en-GB')}` : 'No update available'}><i />{source.name} <b>{age(source)}</b></span>)}</div>
  </div>;
}
