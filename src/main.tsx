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
import './managementFallbackPatch';
import './planLockFetchPatch';
import './marketNormalizationPatch';
import './preferredVehicleAllocationPatch';
import './allocationResiliencePatch';
import './runsReadinessPatch';
import './geofenceRecoveryPatch';
import './commercialRemovalPatch';
import './routeGeocodeFallbackPatch';
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

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const msal = new PublicClientApplication({ auth: { clientId: clientId || '00000000-0000-0000-0000-000000000000', authority: `https://login.microsoftonline.com/${tenantId || 'common'}`, redirectUri: window.location.origin }, cache: { cacheLocation: 'sessionStorage' } });

async function start() {
  await msal.initialize();
  let redirect;
  try {
    redirect = await msal.handleRedirectPromise();
  } catch (error) {
    console.error('Microsoft sign-in callback failed', error);
  }
  const account = redirect?.account || msal.getAllAccounts()[0];
  if (account) msal.setActiveAccount(account);
  createRoot(document.getElementById('root')!).render(<StrictMode><MsalProvider instance={msal}><App /></MsalProvider></StrictMode>);
}

void start();
