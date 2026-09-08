import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { DriverAssignments, LiveTracking } from './pages/Pages';
import { ExportCentre } from './pages/ExportCentre';
import { FuelCardMigration } from './pages/FuelCardMigration';
import { Management } from './pages/Management';
import { NightOutReport } from './pages/NightOutReport';
import { ControlCentre } from './pages/ControlCentre';
import { OrderControl } from './pages/OrderControl';
import { StablePlanner } from './pages/StablePlanner';
import { PlannerEnhanced } from './pages/PlannerEnhanced';
import { PalletPlanningControl } from './pages/PalletPlanningControl';
import { WarehousePlanning } from './pages/WarehousePlanning';
import { DriverDispatch } from './pages/DriverDispatch';
import { RunPerformance } from './pages/RunPerformance';
import { OperationalPlanner } from './pages/OperationalPlanner';
import { PlannerV2 } from './pages/PlannerV2';
import { PlannerV3 } from './pages/PlannerV3';
import { MasterDataHub } from './pages/MasterDataHub';
import { PlanStability, TimelinePage } from './pages/OperationsIntelligence';
import { AttentionAndExceptions } from './pages/AttentionAndExceptions';
import { DashboardOperational } from './pages/DashboardOperational';
import { OperationsWallboard } from './pages/OperationsWallboard';
import { PublicTvBoard } from './pages/PublicTvBoard';
import { TvDisplaySetup } from './pages/TvDisplaySetup';
import { ImportCentre } from './pages/ImportCentre';
import { ReportingOperational } from './pages/ReportingOperational';
import { CustomerCommunications } from './pages/CustomerCommunications';
import { DailyCompliance } from './pages/DailyCompliance';
import { apiScope, useAccessToken } from './lib/auth';
import { api } from './lib/api';
import { TmsAssistant } from './components/TmsAssistant';
import { GlobalSearch } from './components/GlobalSearch';
import { HeaderIntelligence } from './components/HeaderIntelligence';
import { ManagementStabilityBanner } from './components/ManagementStabilityBanner';
import { MobileDock } from './components/MobileDock';

type NavItem = [string, string];
type NavGroup = { label: string; items: NavItem[] };

const topNavigation: NavGroup[] = [
  {
    label: 'Planning',
    items: [
      ['/staging', 'Load Review'],
      ['/', 'Planner'],
      ['/pallet-control', 'Pallet Order'],
      ['/driver-dispatch', 'Driver Dispatch'],
      ['/warehouse', 'Warehouse Loads'],
      ['/communications', 'Customer Communication'],
      ['/operations-wallboard', 'Live Operations'],
      ['/exports', 'Exports'],
    ],
  },
  {
    label: 'Compliance',
    items: [
      ['/night-outs', 'Driver Hours'],
      ['/compliance', 'Compliance'],
      ['/driver-assignments', 'Driver History'],
    ],
  },
  {
    label: 'Management',
    items: [
      ['/management', 'Transport Performance'],
      ['/run-performance', 'Run Performance / Timeline'],
      ['/plan-stability', 'Plan Stability'],
      ['/reporting', 'Reporting'],
    ],
  },
  {
    label: 'Admin',
    items: [
      ['/control-centre', 'Control Centre'],
      ['/master-data', 'Master Data'],
      ['/planner-import', 'Imports'],
    ],
  },
];

function pathActive(current: string, path: string) {
  return path === '/' ? current === '/' : current === path || current.startsWith(`${path}/`);
}

function TopNavGroup({ group, current, reviewOrderCount }: { group: NavGroup; current: string; reviewOrderCount?: number }) {
  const active = group.items.some(([path]) => pathActive(current, path));
  return <details className={`top-nav-group ${active ? 'active' : ''}`}>
    <summary>{group.label}<span aria-hidden="true">⌄</span></summary>
    <div className="top-nav-menu">
      {group.items.map(([path, label]) => <NavLink key={path} to={path} end={path === '/'}>
        <span>{label}</span>
        {path === '/staging' && reviewOrderCount !== undefined && reviewOrderCount > 0 && <b className="nav-count" aria-label={`${reviewOrderCount} loads awaiting review`}>{reviewOrderCount > 1999 ? '2000+' : reviewOrderCount}</b>}
      </NavLink>)}
    </div>
  </details>;
}

function Shell() {
  const authenticated = useIsAuthenticated();
  const { instance, accounts } = useMsal();
  const accessToken = useAccessToken();
  const [open, setOpen] = useState(false);
  const [reviewOrderCount, setReviewOrderCount] = useState<number>();
  const location = useLocation();
  const tvMode = location.pathname === '/operations-wallboard/tv' || location.pathname === '/live-runs/tv' || location.pathname === '/tv';
  const signIn = () => instance.loginRedirect({ scopes: apiScope ? [apiScope] : [] });

  useEffect(() => { setOpen(false); }, [location.pathname]);

  const refreshReviewOrderCount = useCallback(async () => {
    if (!authenticated || tvMode) return;
    try {
      const rows = await api.staging(await accessToken(), 'PendingReview', 'order', 2000);
      setReviewOrderCount(rows.length);
    } catch {
      setReviewOrderCount(undefined);
    }
  }, [accessToken, authenticated, tvMode]);

  useEffect(() => {
    if (!authenticated || tvMode) return;
    void refreshReviewOrderCount();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshReviewOrderCount();
    }, 30000);
    const onFocus = () => void refreshReviewOrderCount();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [authenticated, refreshReviewOrderCount, tvMode]);

  const tvContent = <RouteErrorBoundary key={location.pathname + location.search}><PublicTvBoard /></RouteErrorBoundary>;

  return <div className={`app-shell ${authenticated && !tvMode ? 'with-system-strip top-navigation-shell' : ''} ${tvMode ? 'tv-public-mode' : ''}`}>
    {!tvMode && <header className="top-app-header">
      <button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>☰</button>
      <NavLink className="brand" to="/dashboard"><span>SLH</span><small>Transport management</small></NavLink>
      {authenticated ? <div className="top-nav-search"><GlobalSearch /></div> : <div className="header-context"><b>Daily transport control</b></div>}
      <div className="header-actions">{authenticated ? <><span className="user">{accounts[0]?.name}</span><button onClick={() => instance.logoutRedirect()}>Sign out</button></> : <button className="primary" onClick={signIn} disabled={!apiScope}>Sign in with Microsoft</button>}</div>
    </header>}

    {authenticated && !tvMode && <nav className={`top-navigation ${open ? 'mobile-open' : ''}`} aria-label="Primary TMS navigation">
      <NavLink className="top-nav-direct" to="/dashboard">Daily Dashboard</NavLink>
      {topNavigation.map((group) => <TopNavGroup key={group.label} group={group} current={location.pathname} reviewOrderCount={reviewOrderCount} />)}
    </nav>}

    {authenticated && !tvMode && <div className="system-strip"><HeaderIntelligence /></div>}

    <main className={tvMode ? 'tv-main' : undefined}>{tvMode ? tvContent : authenticated ? <>{location.pathname === '/management' && <ManagementStabilityBanner />}<RouteErrorBoundary key={location.pathname}><Routes>
      <Route path="/" element={<PlannerEnhanced />} />
      <Route path="/dashboard" element={<DashboardOperational />} />
      <Route path="/operations-wallboard" element={<OperationsWallboard />} />
      <Route path="/live-runs" element={<OperationsWallboard />} />
      <Route path="/tv-display" element={<TvDisplaySetup />} />
      <Route path="/order-intake" element={<ImportCentre initialTab="orders" />} />
      <Route path="/jobs" element={<OrderControl initialTab="live" />} />
      <Route path="/driver-dispatch" element={<DriverDispatch />} />
      <Route path="/loads" element={<DriverDispatch />} />
      <Route path="/allocation" element={<DriverDispatch />} />
      <Route path="/pallet-control" element={<PalletPlanningControl />} />
      <Route path="/warehouse" element={<WarehousePlanning />} />
      <Route path="/planner-stable" element={<StablePlanner />} />
      <Route path="/planner-import" element={<ImportCentre />} />
      <Route path="/planner-lab" element={<OperationalPlanner />} />
      <Route path="/planner-v2" element={<PlannerV2 />} />
      <Route path="/planner-v3" element={<PlannerV3 />} />
      <Route path="/driver-assignments" element={<DriverAssignments />} />
      <Route path="/tracking" element={<LiveTracking />} />
      <Route path="/staging" element={<OrderControl />} />
      <Route path="/attention" element={<AttentionAndExceptions />} />
      <Route path="/exceptions" element={<AttentionAndExceptions />} />
      <Route path="/readiness" element={<DashboardOperational />} />
      <Route path="/plan-stability" element={<PlanStability />} />
      <Route path="/timeline/run/:id" element={<TimelinePage kind="run" />} />
      <Route path="/timeline/order/:id" element={<TimelinePage kind="order" />} />
      <Route path="/management" element={<Management />} />
      <Route path="/run-performance" element={<RunPerformance />} />
      <Route path="/night-outs" element={<NightOutReport />} />
      <Route path="/compliance" element={<DailyCompliance />} />
      <Route path="/control-centre" element={<ControlCentre />} />
      <Route path="/operations-control" element={<ControlCentre />} />
      <Route path="/admin" element={<ControlCentre />} />
      <Route path="/driver" element={<DriverDispatch />} />
      <Route path="/communications" element={<CustomerCommunications />} />
      <Route path="/master-data" element={<MasterDataHub />} />
      <Route path="/drivers" element={<MasterDataHub initialSection="drivers" />} />
      <Route path="/fleet-assets" element={<MasterDataHub initialSection="vehicles" />} />
      <Route path="/fuel-cards" element={<MasterDataHub initialSection="fuel-cards" />} />
      <Route path="/customers" element={<MasterDataHub initialSection="customers" />} />
      <Route path="/sites" element={<MasterDataHub initialSection="sites" />} />
      <Route path="/markets" element={<MasterDataHub initialSection="markets" />} />
      <Route path="/fuel" element={<MasterDataHub initialSection="fuel-prices" />} />
      <Route path="/admin/fuel-card-migration" element={<FuelCardMigration />} />
      <Route path="/reporting" element={<ReportingOperational />} />
      <Route path="/exports" element={<ExportCentre />} />
    </Routes></RouteErrorBoundary></> : <section className="sign-in-panel"><p className="eyebrow">Secure operations portal</p><h1>Sign in to Stuart Lyons Haulage TMS</h1><p>Use your Lyons Microsoft account to open live planning, fleet tracking, orders and master data.</p><button className="primary" onClick={signIn} disabled={!apiScope}>Sign in with Microsoft</button></section>}</main>

    {authenticated && !tvMode && <><TmsAssistant /><MobileDock openMenu={() => setOpen(true)} /></>}
  </div>;
}

type RouteErrorBoundaryState = { error?: Error };
class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {};
  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('TMS route failed', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const error = this.state.error;
    return <section className="sign-in-panel"><p className="eyebrow">Application recovery</p><h1>This screen hit an application error</h1><p>The navigation shell is still available and you have not been signed out.</p><div style={{ width: '100%', maxWidth: 900, textAlign: 'left', margin: '16px 0', padding: 16, border: '1px solid #d0d7de', borderRadius: 8, background: '#fff' }}><strong>Error detail</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8 }}>{error.name}: {error.message}</pre></div><button className="primary" onClick={() => window.location.reload()}>Refresh screen</button></section>;
  }
}

export function App() { return <BrowserRouter><Shell /></BrowserRouter>; }
