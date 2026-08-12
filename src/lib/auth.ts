import type { AccountInfo } from '@azure/msal-browser';
import { useMsal } from '@azure/msal-react';

export const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE;

export function useAccessToken() {
  const { instance, accounts } = useMsal();
  return async () => {
    if (!apiScope) throw new Error('Live API access is not configured.');
    const account: AccountInfo | undefined = instance.getActiveAccount() || accounts[0];
    if (!account) throw new Error('Your Microsoft sign-in has expired. Please sign in again.');
    try { return (await instance.acquireTokenSilent({ account, scopes: [apiScope] })).accessToken; }
    catch { await instance.acquireTokenRedirect({ account, scopes: [apiScope] }); throw new Error('Microsoft sign-in is required to refresh live data.'); }
  };
}
