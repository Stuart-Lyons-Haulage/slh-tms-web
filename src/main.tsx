import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { App } from './App';
import './runtimeGuards';
import './orderPlanningSyncBridge';
import './plannerEmptyStopsPatch';
import './fleetioSyncPatch';
import './masterDataCleanupFetchPatch';
import './operationalPresentationPatch';
import './typeaheadLookupPatch';
import './automaticRefreshPresentationPatch';
import './managementFallbackPatch';
import './planLockFetchPatch';
import './marketNormalizationPatch';
import './preferredVehicleAllocationPatch';
import './allocationResiliencePatch';
import './runsReadinessPatch';
import './geofenceRecoveryPatch';
import './commercialRemovalPatch';
import './routeGeocodeFallbackPatch';
import './pollingLoadGuard';
import './wallboardSnapshotFetchPatch';
import './overnightWallboardFetchPatch';
import './liveVehiclePopupPatch';
import './naturalRunOrderPatch';
import './styles.css';
import './orders.css';
import './fuel-top.css';
import './management.css';
import './operational-status.css';
import './navigation-scroll.css';
import './intelligence.css';
import './mobile.css';
import './ops-cleanup.css';
import './mobile-v2.css';
import './mobile-planner.css';
import './master-fleet.css';
import './live-vehicle-popup.css';
import './operations-housekeeping.css';

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const msal = new PublicClientApplication({ auth: { clientId: clientId || '00000000-0000-0000-0000-000000000000', authority: `https://login.microsoftonline.com/${tenantId || 'common'}`, redirectUri: window.location.origin }, cache: { cacheLocation: 'sessionStorage' } });

const tvPaths = new Set(['/tv', '/operations-wallboard/tv', '/live-runs/tv']);
const publicTvLink = tvPaths.has(window.location.pathname) && new URLSearchParams(window.location.search).has('key');
const legacyTvRuntime = Boolean((window as Window & { __SLH_LEGACY_TV__?: boolean }).__SLH_LEGACY_TV__);

function renderApp() {
  const root = document.getElementById('root');
  if (!root) throw new Error('TMS root element is missing.');
  createRoot(root).render(<StrictMode><MsalProvider instance={msal}><App /></MsalProvider></StrictMode>);
}

function showStartupFailure(error: unknown) {
  console.error('TMS startup failed', error);
  const root = document.getElementById('root');
  if (!root) return;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  root.innerHTML = `<main style="font-family:Arial,sans-serif;padding:32px;background:#f7f8fa;min-height:100vh;color:#172033"><section style="max-width:760px;margin:40px auto;background:white;border:1px solid #d7dde5;border-radius:12px;padding:28px"><p style="font-weight:700">SLH OPERATIONS WALLBOARD</p><h1>TV wallboard could not start</h1><p>The display has not lost its planning data. Reload this page once. If the message remains, report the detail below.</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f7;padding:14px;border-radius:8px">${detail.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></section></main>`;
}

async function start() {
  try {
    if (legacyTvRuntime && tvPaths.has(window.location.pathname)) {
      // The TV compatibility runtime is intentionally plain ES5/XHR so older
      // Hisense/VIDAA browsers do not depend on modules, React, MSAL or fetch.
      return;
    }
    if (publicTvLink) {
      renderApp();
      void msal.initialize().catch((error) => console.warn('MSAL unavailable in keyed TV mode; continuing with TV-key access.', error));
      return;
    }

    await msal.initialize();
    let redirect;
    try {
      redirect = await msal.handleRedirectPromise();
    } catch (error) {
      console.error('Microsoft sign-in callback failed', error);
    }
    const account = redirect?.account || msal.getAllAccounts()[0];
    if (account) msal.setActiveAccount(account);
    renderApp();
  } catch (error) {
    showStartupFailure(error);
  }
}

void start();
