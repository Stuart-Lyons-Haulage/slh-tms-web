import { useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { intelligenceApi } from '../lib/intelligenceApi';

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const daysAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate()-days); return iso(d); };

export function ManagementStabilityBanner() {
  const token = useAccessToken();
  const report = useApi(useCallback(async () => intelligenceApi.stability(daysAgo(29), iso(new Date()), await token()), [token]));
  if (report.error) return <NavLink className="management-stability-link" to="/plan-stability"><div><strong>Plan Stability</strong><span>Detailed stability reporting is available; live summary could not be loaded.</span></div><b>Open ›</b></NavLink>;
  return <NavLink className="management-stability-link" to="/plan-stability"><div><strong>Plan Stability {report.data?.stabilityPercent == null ? '—' : `${report.data.stabilityPercent.toFixed(1)}%`}</strong><span>{report.data ? `${report.data.changedRuns} changed runs · ${report.data.driverSwaps} driver swaps · ${report.data.vehicleSwaps} vehicle swaps · ${report.data.routeAmendments} route amendments over 30 days` : 'Calculating 30-day locked-plan performance…'}</span></div><b>View detail ›</b></NavLink>;
}
