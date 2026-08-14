import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Admin, Dashboard, DriverAssignments, DriversMaster, Exceptions, ExportCentre, FleetAssetsMaster, FuelMaster, LiveTracking, Loads, MarketsMaster, MasterData, Orders, PlanningBoard, Reporting, SitesMaster, StagingQueue } from './pages/Pages';
import { apiScope } from './lib/auth';
import { TmsAssistant } from './components/TmsAssistant';

const navigation = [['/', 'Planner'], ['/dashboard', 'Operations dashboard'], ['/order-intake', 'Order entry'], ['/loads', 'Loads'], ['/allocation', 'Allocation'], ['/driver-assignments', 'Driver assignments'], ['/tracking', 'Live tracking'], ['/staging', 'Staging review'], ['/exceptions', 'Exceptions'], ['/drivers', 'Drivers'], ['/fleet-assets', 'Vehicles + fuel / trailers'], ['/markets', 'Markets'], ['/fuel', 'Fuel'], ['/sites', 'Sites & contacts'], ['/master-data', 'Master data overview'], ['/reporting', 'Reporting'], ['/exports', 'Exports'], ['/admin', 'Admin']];

function Shell() {
  const authenticated = useIsAuthenticated(); const { instance, accounts } = useMsal(); const [open, setOpen] = useState(false); const location = useLocation();
  const signIn = () => instance.loginRedirect({ scopes: apiScope ? [apiScope] : [] });
  return <div className="app-shell"><header><button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation">☰</button><NavLink className="brand" to="/"><span>SLH</span><small>Operations planner</small></NavLink><div className="header-context"><b>Today’s transport plan</b><small>Control loads, drivers and exceptions</small></div><div className="header-actions">{authenticated ? <><span className="user">{accounts[0]?.name}</span><button onClick={() => instance.logoutRedirect()}>Sign out</button></> : <button className="primary" onClick={signIn} disabled={!apiScope}>Sign in with Microsoft</button>}</div></header><aside className={`side-nav ${open ? 'open' : ''}`}><NavLink className="new-order" to="/order-intake" onClick={() => setOpen(false)}>＋ New order</NavLink><div className="nav-title">Daily control</div>{navigation.slice(0, 7).map(([path, label]) => <NavLink key={path} to={path} end={path === '/'} onClick={() => setOpen(false)}>{label}</NavLink>)}<div className="nav-title">Master data</div>{navigation.slice(9, 15).map(([path, label]) => <NavLink key={path} to={path} end={path === '/'} onClick={() => setOpen(false)}>{label}</NavLink>)}<div className="nav-title">Setup & insight</div>{[...navigation.slice(7, 9), ...navigation.slice(15)].map(([path, label]) => <NavLink key={path} to={path} end={path === '/'} onClick={() => setOpen(false)}>{label}</NavLink>)}</aside><main>{authenticated ? <RouteErrorBoundary key={location.pathname}><Routes><Route path="/" element={<PlanningBoard />} /><Route path="/dashboard" element={<Dashboard />} /><Route path="/order-intake" element={<Orders />} /><Route path="/loads" element={<Loads />} /><Route path="/allocation" element={<PlanningBoard />} /><Route path="/driver-assignments" element={<DriverAssignments />} /><Route path="/tracking" element={<LiveTracking />} /><Route path="/staging" element={<StagingQueue />} /><Route path="/exceptions" element={<Exceptions />} /><Route path="/drivers" element={<DriversMaster />} /><Route path="/fleet-assets" element={<FleetAssetsMaster />} /><Route path="/markets" element={<MarketsMaster />} /><Route path="/fuel" element={<FuelMaster />} /><Route path="/sites" element={<SitesMaster />} /><Route path="/reporting" element={<Reporting />} /><Route path="/exports" element={<ExportCentre />} /><Route path="/master-data" element={<MasterData />} /><Route path="/admin" element={<Admin />} /></Routes></RouteErrorBoundary> : <section className="sign-in-panel"><p className="eyebrow">Secure operations portal</p><h1>Sign in to Stuart Lyons Haulage TMS</h1><p>Use your Lyons Microsoft account to open live planning, fleet tracking, orders and master data.</p><button className="primary" onClick={signIn} disabled={!apiScope}>Sign in with Microsoft</button></section>}</main>{authenticated && <TmsAssistant />}</div>;
}

type RouteErrorBoundaryState = { error?: Error };
class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {};
  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('TMS route failed', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <section className="sign-in-panel"><p className="eyebrow">Planner recovery</p><h1>This page needs a refresh</h1><p>The navigation shell is still available. Refresh the page to retry the live planner without signing you out.</p><button className="primary" onClick={() => window.location.reload()}>Refresh planner</button></section>;
  }
}

export function App() { return <BrowserRouter><Shell /></BrowserRouter>; }
