import type { AccountInfo } from '@azure/msal-browser';
import { useMsal } from '@azure/msal-react';
import { useCallback } from 'react';

export const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE;

export function useAccessToken() {
  const { instance, accounts } = useMsal();
  return useCallback(async () => {
    if (!apiScope) throw new Error('Live API access is not configured.');
    const account: AccountInfo | undefined = instance.getActiveAccount() || accounts[0];
    if (!account) throw new Error('Your Microsoft sign-in has expired. Please sign in again.');
    try { return (await instance.acquireTokenSilent({ account, scopes: [apiScope] })).accessToken; }
    catch {
      try { return (await instance.acquireTokenPopup({ account, scopes: [apiScope] })).accessToken; }
      catch { throw new Error('Microsoft sign-in needs refreshing before live data can load. Use Refresh or sign in again.'); }
    }
  }, [accounts, instance]);
}
