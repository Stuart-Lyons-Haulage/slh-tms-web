import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Admin, CustomersMaster, Dashboard, DriverAssignments, DriverMobile, Exceptions, ExportCentre, FuelMaster, LiveTracking, MarketsMaster, MasterData, OperationsControl, Reporting, SitesMaster, StagingQueue } from './pages/Pages';
import { DriversUnified } from './pages/DriversUnified';
import { FleetAssetsOperational } from './pages/FleetAssetsOperational';
import { FuelCardsOperational } from './pages/FuelCardsOperational';
import { JobsOperational } from './pages/JobsOperational';
import { OrdersOperationalV2 } from './pages/OrdersOperationalV2';
import { RunsOperational } from './pages/RunsOperational';
import { StablePlanner } from './pages/StablePlanner';
import { OperationalPlanner } from './pages/OperationalPlanner';
import { PlannerV2 } from './pages/PlannerV2';
import { PlannerV3 } from './pages/PlannerV3';
import { apiScope } from './lib/auth';
import { TmsAssistant } from './components/TmsAssistant';

const dailyNavigation = [
  ['/dashboard', 'Dashboard'],
  ['/order-intake', 'Orders'],
  ['/jobs', 'Manage jobs'],
  ['/staging', 'Order review'],
  ['/', 'Planner'],
  ['/loads', 'Runs'],
  ['/tracking', 'Live tracking'],
];

const masterNavigation = [
  ['/customers', 'Customers'],
  ['/drivers', 'Drivers'],
  ['/fleet-assets', 'Vehicles / trailers'],
  ['/fuel-cards', 'Fuel cards & PINs'],
  ['/fuel', 'Fuel prices'],
  ['/markets', 'Markets'],
  ['/sites', 'Sites & contacts'],
  ['/master-data', 'Master data overview'],
];

const insightNavigation = [
  ['/exceptions', 'Exceptions'],
  ['/operations-control', 'Ops control'],
  ['/reporting', 'Reporting'],
  ['/exports', 'Exports'],
  ['/admin', 'Admin'],
];

function Shell() {
  const authenticated = useIsAuthenticated(); const { instance, accounts } = useMsal(); const [open, setOpen] = useState(false); const location = useLocation();
  const signIn = () => instance.loginRedirect({ scopes: apiScope ? [apiScope] : [] });
  return <div className="app-shell"><header><button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation">☰</button><NavLink className="brand" to="/dashboard"><span>SLH</span><small>Transport management</small></NavLink><div className="header-context"><b>Daily transport control</b><small>Orders → planning → runs → live operations</small></div><div className="header-actions">{authenticated ? <><span className="user">{accounts[0]?.name}</span><button onClick={() => instance.logoutRedirect()}>Sign out</button></> : <button className="primary" onClick={signIn} disabled={!apiScope}>Sign in with Microsoft</button>}</div></header><aside className={`side-nav ${open ? 'open' : ''}`}><NavLink className="new-order" to="/order-intake" onClick={() => setOpen(false)}>＋ New order</NavLink><div className="nav-title">Daily workflow</div>{dailyNavigation.map(([path, label]) => <NavLink key={path} to={path} end={path === '/'} onClick={() => setOpen(false)}>{label}</NavLink>)}<div className="nav-title">Master data</div>{masterNavigation.map(([path, label]) => <NavLink key={path} to={path} onClick={() => setOpen(false)}>{label}</NavLink>)}<div className="nav-title">Control & insight</div>{insightNavigation.map(([path, label]) => <NavLink key={path} to={path} onClick={() => setOpen(false)}>{label}</NavLink>)}</aside><main>{authenticated ? <RouteErrorBoundary key={location.pathname}><Routes><Route path="/" element={<PlannerV3 />} /><Route path="/dashboard" element={<Dashboard />} /><Route path="/order-intake" element={<OrdersOperationalV2 />} /><Route path="/jobs" element={<JobsOperational />} /><Route path="/loads" element={<RunsOperational />} /><Route path="/allocation" element={<PlannerV3 />} /><Route path="/planner-stable" element={<StablePlanner />} /><Route path="/planner-lab" element={<OperationalPlanner />} /><Route path="/planner-v2" element={<PlannerV2 />} /><Route path="/planner-v3" element={<PlannerV3 />} /><Route path="/driver-assignments" element={<DriverAssignments />} /><Route path="/tracking" element={<LiveTracking />} /><Route path="/staging" element={<StagingQueue />} /><Route path="/exceptions" element={<Exceptions />} /><Route path="/operations-control" element={<OperationsControl />} /><Route path="/driver" element={<DriverMobile />} /><Route path="/customers" element={<CustomersMaster />} /><Route path="/drivers" element={<DriversUnified />} /><Route path="/fleet-assets" element={<FleetAssetsOperational />} /><Route path="/fuel-cards" element={<FuelCardsOperational />} /><Route path="/fuel" element={<FuelMaster />} /><Route path="/markets" element={<MarketsMaster />} /><Route path="/sites" element={<SitesMaster />} /><Route path="/reporting" element={<Reporting />} /><Route path="/exports" element={<ExportCentre />} /><Route path="/master-data" element={<MasterData />} /><Route path="/admin" element={<Admin />} /></Routes></RouteErrorBoundary> : <section className="sign-in-panel"><p className="eyebrow">Secure operations portal</p><h1>Sign in to Stuart Lyons Haulage TMS</h1><p>Use your Lyons Microsoft account to open live planning, fleet tracking, orders and master data.</p><button className="primary" onClick={signIn} disabled={!apiScope}>Sign in with Microsoft</button></section>}</main>{authenticated && <TmsAssistant />}</div>;
}

type RouteErrorBoundaryState = { error?: Error };
class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {};
  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('TMS route failed', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const error = this.state.error;
    return <section className="sign-in-panel">
      <p className="eyebrow">Application recovery</p>
      <h1>This screen hit an application error</h1>
      <p>The navigation shell is still available and you have not been signed out.</p>
      <div style={{ width: '100%', maxWidth: 900, textAlign: 'left', margin: '16px 0', padding: 16, border: '1px solid #d0d7de', borderRadius: 8, background: '#fff' }}>
        <strong>Error detail</strong>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8 }}>{error.name}: {error.message}</pre>
      </div>
      <button className="primary" onClick={() => window.location.reload()}>Refresh screen</button>
    </section>;
  }
}

export function App() { return <BrowserRouter><Shell /></BrowserRouter>; }
