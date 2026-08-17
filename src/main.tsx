import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { App } from './App';
import './runtimeGuards';
import './fleetioSyncPatch';
import './styles.css';
import './orders.css';
import './fuel-top.css';

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
