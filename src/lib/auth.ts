import type { AccountInfo } from '@azure/msal-browser';
import { useMsal } from '@azure/msal-react';
import { useCallback } from 'react';
import { runtimeConfig } from './runtimeConfig';

const productionApiScope = 'api://497f6ea5-9753-43ee-8ccf-afaa0a3869c2/Tms.Access';
export const apiScope = runtimeConfig.entraApiScope || productionApiScope;
export function useAccessToken() {
  const { instance, accounts } = useMsal();
  return useCallback(async () => {
    if (!apiScope) throw new Error('Live API access is not configured.');
    const account: AccountInfo | undefined = instance.getActiveAccount() || accounts[0];
    if (!account) throw new Error('Your Microsoft sign-in has expired. Please sign in again.');
    try { return (await instance.acquireTokenSilent({ account, scopes: [apiScope] })).accessToken; }
    catch { throw new Error('Microsoft sign-in needs refreshing before live data can load. Reconnect securely, then retry this panel.'); }
  }, [accounts, instance]);
}
