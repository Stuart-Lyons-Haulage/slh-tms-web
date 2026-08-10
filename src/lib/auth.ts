import type { AccountInfo } from '@azure/msal-browser';
import { useMsal } from '@azure/msal-react';

export const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE;

export function useAccessToken() {
  const { instance, accounts } = useMsal();
  return async () => {
    if (!apiScope) return undefined;
    const account: AccountInfo | undefined = accounts[0];
    if (!account) return undefined;
    try { return (await instance.acquireTokenSilent({ account, scopes: [apiScope] })).accessToken; }
    catch { await instance.acquireTokenRedirect({ scopes: [apiScope] }); return undefined; }
  };
}
