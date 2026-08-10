import { useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Dashboard, LiveTracking, Loads, MasterData, OperationalPlaceholder, Orders, PlanningBoard, StagingQueue } from './pages/Pages';
import { apiScope } from './lib/auth';

const navigation = [['/', 'Operations'], ['/order-intake', 'Order intake'], ['/planning', 'Planning board'], ['/loads', 'Loads'], ['/allocation', 'Allocation'], ['/tracking', 'Live tracking'], ['/staging', 'Staging review'], ['/exceptions', 'Exceptions'], ['/master-data', 'Master data & CRM'], ['/reporting', 'Reporting'], ['/exports', 'Exports'], ['/admin', 'Admin']];

function Shell() {
  const authenticated = useIsAuthenticated(); const { instance, accounts } = useMsal(); const [open, setOpen] = useState(false);
  const signIn = () => instance.loginRedirect({ scopes: apiScope ? [apiScope] : [] });
  return <div className="app-shell"><header><button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation">☰</button><div className="brand"><span>SLH</span><small>Transport Management</small></div><div className="header-actions">{authenticated ? <><span className="user">{accounts[0]?.name}</span><button onClick={() => instance.logoutRedirect()}>Sign out</button></> : <button className="primary" onClick={signIn} disabled={!apiScope}>Sign in with Microsoft</button>}</div></header><aside className={open ? 'open' : ''}><div className="nav-title">Control centre</div>{navigation.map(([path, label]) => <NavLink key={path} to={path} end={path === '/'} onClick={() => setOpen(false)}>{label}</NavLink>)}</aside><main>{!authenticated && <div className="notice">Connect Microsoft Entra ID to use live TMS data. Configure the values in `.env.local`.</div>}<Routes><Route path="/" element={<Dashboard />} /><Route path="/order-intake" element={<Orders />} /><Route path="/planning" element={<PlanningBoard />} /><Route path="/loads" element={<Loads />} /><Route path="/tracking" element={<LiveTracking />} /><Route path="/staging" element={<StagingQueue />} /><Route path="/master-data" element={<MasterData />} />{navigation.slice(1).filter(([path]) => !['/order-intake', '/planning', '/loads', '/tracking', '/staging', '/master-data'].includes(path)).map(([path, label]) => <Route key={path} path={path} element={<OperationalPlaceholder title={label} />} />)}</Routes></main></div>;
}
export function App() { return <BrowserRouter><Shell /></BrowserRouter>; }
