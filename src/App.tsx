import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { DriverAssignments, DriverMobile, LiveTracking } from './pages/Pages';
import { ExportCentre } from './pages/ExportCentre';
import { FuelCardMigration } from './pages/FuelCardMigration';
import { Management } from './pages/Management';
import { NightOutReport } from './pages/NightOutReport';
import { ControlCentre } from './pages/ControlCentre';
import { OrderControl } from './pages/OrderControl';
import { RunsOperational } from './pages/RunsOperational';
import { StablePlanner } from './pages/StablePlanner';
import { PlannerEnhanced } from './pages/PlannerEnhanced';
import { PalletPlanningControl } from './pages/PalletPlanningControl';
import { OperationalPlanner } from './pages/OperationalPlanner';
import { PlannerV2 } from './pages/PlannerV2';
import { PlannerV3 } from './pages/PlannerV3';
import { MasterDataHub } from './pages/MasterDataHub';
import { PlanStability, TimelinePage } from './pages/OperationsIntelligence';
import { AttentionAndExceptions } from './pages/AttentionAndExceptions';
import { DashboardOperational } from './pages/DashboardOperational';
import { LiveRunsBoard } from './pages/LiveRunsBoard';
import { PublicTvBoard } from './pages/PublicTvBoard';
import { TvDisplaySetup } from './pages/TvDisplaySetup';
import { ImportCentre } from './pages/ImportCentre';
import { ReportingOperational } from './pages/ReportingOperational';
import { apiScope } from './lib/auth';
import { TmsAssistant } from './components/TmsAssistant';
import { GlobalSearch } from './components/GlobalSearch';
import { HeaderIntelligence } from './components/HeaderIntelligence';
import { ManagementStabilityBanner } from './components/ManagementStabilityBanner';
import { MobileDock } from './components/MobileDock';

const dailyNavigation = [
  ['/dashboard', 'Dashboard'], ['/live-runs', 'Live runs'], ['/tv-display', 'TV display'], ['/', 'Planner'], ['/pallet-control', 'Pallet control'], ['/planner-import', 'Import planner plan'], ['/loads', 'Runs'], ['/tracking', 'Live tracking'],
];
const masterNavigation = [['/master-data', 'Master data']];
const insightNavigation = [
  ['/management', 'Management'], ['/night-outs', 'Night outs'], ['/plan-stability', 'Plan stability'], ['/control-centre', 'Control centre'], ['/reporting', 'Reporting'], ['/exports', 'Exports'],
];

type NavItem = string[];
function pathActive(current: string, path: string) { return path === '/' ? current === '/' : current === path || current.startsWith(`${path}/`); }
function NavSection({ title, storageKey, items, current, closeMobile }: { title: string; storageKey: string; items: NavItem[]; current: string; closeMobile: () => void }) {
  const active = items.some(([path]) => pathActive(current, path));
  const [open, setOpen] = useState(() => localStorage.getItem(storageKey) !== 'closed');
  const expanded = open || active;
  const toggle = () => { const next = !open; setOpen(next); localStorage.setItem(storageKey, next ? 'open' : 'closed'); };
  return <div className="nav-section"><button className="nav-title nav-toggle" onClick={toggle} aria-expanded={expanded}><span>{title}</span><b>{expanded ? '−' : '+'}</b></button>{expanded && <div className="nav-links">{items.map(([path,label]) => <NavLink key={path} to={path} end={path === '/'} onClick={closeMobile}>{label}</NavLink>)}</div>}</div>;
}

function Shell() {
  const authenticated = useIsAuthenticated();
  const { instance, accounts } = useMsal();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const tvMode = location.pathname === '/live-runs/tv' || location.pathname === '/tv';
  const signIn = () => instance.loginRedirect({ scopes: apiScope ? [apiScope] : [] });
  const closeMobile = () => setOpen(false);
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return <div className={`app-shell ${authenticated && !tvMode ? 'with-system-strip' : ''} ${tvMode ? 'tv-public-mode' : ''}`}>
    {!tvMode && <header>
      <button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>☰</button>
      <NavLink className="brand" to="/dashboard"><span>SLH</span><small>Transport management</small></NavLink>
      {authenticated ? <GlobalSearch /> : <div className="header-context"><b>Daily transport control</b><small>Orders → planning → runs → live operations</small></div>}
      <div className="header-actions">{authenticated ? <><span className="user">{accounts[0]?.name}</span><button onClick={() => instance.logoutRedirect()}>Sign out</button></> : <button className="primary" onClick={signIn} disabled={!apiScope}>Sign in with Microsoft</button>}</div>
    </header>}
    {authenticated && !tvMode && <div className="system-strip"><HeaderIntelligence /></div>}
    {authenticated && !tvMode && open && <button className="mobile-nav-scrim" type="button" aria-label="Close navigation" onClick={closeMobile} />}
    {!tvMode && <aside className={`side-nav ${open ? 'open' : ''}`}>
      {authenticated && <div className="mobile-nav-search"><GlobalSearch /></div>}
      <NavSection title="Daily workflow" storageKey="slh-nav-daily" items={dailyNavigation} current={location.pathname} closeMobile={closeMobile}/>
      <NavSection title="Master data" storageKey="slh-nav-master" items={masterNavigation} current={location.pathname} closeMobile={closeMobile}/>
      <NavSection title="Control & insight" storageKey="slh-nav-insight" items={insightNavigation} current={location.pathname} closeMobile={closeMobile}/>
      {authenticated && <button className="mobile-sign-out" type="button" onClick={() => instance.logoutRedirect()}>Sign out · {accounts[0]?.name || 'Microsoft account'}</button>}
    </aside>}
    <main className={tvMode ? 'tv-main' : undefined}>{tvMode ? <RouteErrorBoundary key={location.pathname}><PublicTvBoard /></RouteErrorBoundary> : authenticated ? <>{location.pathname === '/management' && <ManagementStabilityBanner />}<RouteErrorBoundary key={location.pathname}><Routes>
      <Route path="/" element={<PlannerEnhanced />} /><Route path="/dashboard" element={<DashboardOperational />} /><Route path="/live-runs" element={<LiveRunsBoard />} /><Route path="/tv-display" element={<TvDisplaySetup />} /><Route path="/order-intake" element={<ImportCentre initialTab="orders" />} /><Route path="/jobs" element={<OrderControl initialTab="live" />} /><Route path="/loads" element={<RunsOperational />} /><Route path="/allocation" element={<PlannerEnhanced />} /><Route path="/pallet-control" element={<PalletPlanningControl />} /><Route path="/planner-stable" element={<StablePlanner />} /><Route path="/planner-import" element={<ImportCentre />} /><Route path="/planner-lab" element={<OperationalPlanner />} /><Route path="/planner-v2" element={<PlannerV2 />} /><Route path="/planner-v3" element={<PlannerV3 />} /><Route path="/driver-assignments" element={<DriverAssignments />} /><Route path="/tracking" element={<LiveTracking />} /><Route path="/staging" element={<OrderControl />} />
      <Route path="/attention" element={<AttentionAndExceptions />} /><Route path="/exceptions" element={<AttentionAndExceptions />} /><Route path="/readiness" element={<DashboardOperational />} /><Route path="/plan-stability" element={<PlanStability />} /><Route path="/timeline/run/:id" element={<TimelinePage kind="run" />} /><Route path="/timeline/order/:id" element={<TimelinePage kind="order" />} />
      <Route path="/management" element={<Management />} /><Route path="/night-outs" element={<NightOutReport />} /><Route path="/control-centre" element={<ControlCentre />} /><Route path="/operations-control" element={<ControlCentre />} /><Route path="/admin" element={<ControlCentre />} /><Route path="/driver" element={<DriverMobile />} />
      <Route path="/master-data" element={<MasterDataHub />} /><Route path="/drivers" element={<MasterDataHub initialSection="drivers" />} /><Route path="/fleet-assets" element={<MasterDataHub initialSection="vehicles" />} /><Route path="/fuel-cards" element={<MasterDataHub initialSection="fuel-cards" />} /><Route path="/customers" element={<MasterDataHub initialSection="customers" />} /><Route path="/sites" element={<MasterDataHub initialSection="sites" />} /><Route path="/markets" element={<MasterDataHub initialSection="markets" />} /><Route path="/fuel" element={<MasterDataHub initialSection="fuel-prices" />} />
      <Route path="/admin/fuel-card-migration" element={<FuelCardMigration />} /><Route path="/reporting" element={<ReportingOperational />} /><Route path="/exports" element={<ExportCentre />} />
    </Routes></RouteErrorBoundary></> : <section className="sign-in-panel"><p className="eyebrow">Secure operations portal</p><h1>Sign in to Stuart Lyons Haulage TMS</h1><p>Use your Lyons Microsoft account to open live planning, fleet tracking, orders and master data.</p><button className="primary" onClick={signIn} disabled={!apiScope}>Sign in with Microsoft</button></section>}</main>
    {authenticated && !tvMode && <><TmsAssistant /><MobileDock openMenu={() => setOpen(true)} /></>}
  </div>;
}

type RouteErrorBoundaryState = { error?: Error };
class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {};
  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('TMS route failed', error, info); }
  render() { if (!this.state.error) return this.props.children; const error = this.state.error; return <section className="sign-in-panel"><p className="eyebrow">Application recovery</p><h1>This screen hit an application error</h1><p>The navigation shell is still available and you have not been signed out.</p><div style={{ width: '100%', maxWidth: 900, textAlign: 'left', margin: '16px 0', padding: 16, border: '1px solid #d0d7de', borderRadius: 8, background: '#fff' }}><strong>Error detail</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8 }}>{error.name}: {error.message}</pre></div><button className="primary" onClick={() => window.location.reload()}>Refresh screen</button></section>; }
}

export function App() { return <BrowserRouter><Shell /></BrowserRouter>; }
