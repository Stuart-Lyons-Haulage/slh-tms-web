import { useCallback, useEffect, useMemo, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';

export type WarehouseMovement = {
  direction: 'Inbound' | 'Outbound'; loadId: string; runReference: string; period: string;
  driver?: string; vehicle?: string; trailer?: string; customer: string; from?: string; to?: string;
  poReference?: string; loadReference?: string; palletType?: string; plannedPallets: number;
  temperature?: string; dueDate?: string; dueTime?: string; expectedAtUtc?: string; status: string; difference?: number;
};
export type WarehouseDailyResult = {
  planningDate: string; inbound: WarehouseMovement[]; outbound: WarehouseMovement[];
  totals: { inboundRows: number; outboundRows: number; inboundPallets: number; outboundPallets: number };
};

export function warehouseDisplayRows(data: WarehouseDailyResult) {
  return [...data.inbound, ...data.outbound].sort((a, b) =>
    (a.expectedAtUtc || `${data.planningDate}T23:59:59Z`).localeCompare(b.expectedAtUtc || `${data.planningDate}T23:59:59Z`) ||
    a.runReference.localeCompare(b.runReference));
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function expectedTime(row: WarehouseMovement) {
  if (row.expectedAtUtc) return new Date(row.expectedAtUtc).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return row.dueTime?.slice(0, 5) || 'Awaiting plan';
}

export function WarehousePlanning() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const data = useApi(useCallback(async () => request<WarehouseDailyResult>(`/api/v1/warehouse/daily?date=${encodeURIComponent(date)}`, await token()), [date, token]));
  const refresh = data.refresh;
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const rows = useMemo(() => data.data ? warehouseDisplayRows(data.data) : [], [data.data]);

  return <section className="page warehouse-page">
    <div className="page-heading warehouse-heading">
      <div><p className="eyebrow">Barnham warehouse control</p><h1>Warehouse load list</h1><p>Every inbound and outbound movement involving Barnham Coldstore or Stuart Lyons Distribution.</p></div>
      <div className="warehouse-actions"><label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><button type="button" onClick={() => window.print()}>Print load list</button></div>
    </div>
    {data.loading && <p className="notice">Loading warehouse movements…</p>}
    {data.error && <p className="notice error">Warehouse movements could not be loaded: {data.error}</p>}
    {data.data && <>
      <div className="warehouse-totals"><article><span>Inbound</span><strong>{data.data.totals.inboundPallets}</strong><small>{data.data.totals.inboundRows} movements</small></article><article><span>Outbound</span><strong>{data.data.totals.outboundPallets}</strong><small>{data.data.totals.outboundRows} movements</small></article><article><span>Total handling</span><strong>{data.data.totals.inboundPallets + data.data.totals.outboundPallets}</strong><small>pallet movements</small></article></div>
      <div className="table-scroll"><table className="warehouse-table"><thead><tr><th>Expected</th><th>Direction</th><th>Customer</th><th>Pallets</th><th>Driver</th><th>Run</th><th>From / To</th><th>Vehicle</th><th>References</th><th>Status</th><th>Actual / difference</th></tr></thead><tbody>
        {rows.map(row => <tr key={`${row.loadId}-${row.direction}-${row.loadReference || row.poReference || row.customer}`}><td><strong>{expectedTime(row)}</strong></td><td><span className={`warehouse-direction ${row.direction.toLowerCase()}`}>{row.direction}</span></td><td>{row.customer}</td><td><strong>{row.plannedPallets}</strong><small>{row.palletType || 'Pallet type TBC'}</small></td><td>{row.driver || 'Unallocated'}</td><td>{row.runReference} <small>{row.period}</small></td><td>{row.from || 'TBC'}<small>→ {row.to || 'TBC'}</small></td><td>{row.vehicle || 'TBC'}<small>{row.trailer || ''}</small></td><td>{row.poReference || 'No PO'}<small>{row.loadReference || ''}</small></td><td>{row.status}</td><td className="warehouse-write-cell">{row.difference == null ? '' : row.difference}</td></tr>)}
        {rows.length === 0 && <tr><td colSpan={11} className="empty-state">No Barnham warehouse movements are planned for this date.</td></tr>}
      </tbody></table></div>
    </>}
  </section>;
}
