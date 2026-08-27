export type TmsRuntimeConfig = {
  environmentName?: string;
  apiBaseUrl?: string;
  entraTenantId?: string;
  entraClientId?: string;
  entraApiScope?: string;
  azureMapsClientId?: string;
  featureFlags?: Record<string, boolean | string | number>;
};

declare global {
  interface Window {
    __SLH_TMS_CONFIG__?: TmsRuntimeConfig;
    __SLH_TMS_DESKTOP__?: boolean;
  }
}

const runtime = typeof window === "undefined" ? {} : window.__SLH_TMS_CONFIG__ || {};

export const runtimeConfig = {
  environmentName: runtime.environmentName || import.meta.env.VITE_TMS_ENVIRONMENT || "Development",
  apiBaseUrl: runtime.apiBaseUrl || import.meta.env.VITE_API_BASE_URL || "/tms-api",
  entraTenantId: runtime.entraTenantId || import.meta.env.VITE_ENTRA_TENANT_ID || "",
  entraClientId: runtime.entraClientId || import.meta.env.VITE_ENTRA_CLIENT_ID || "",
  entraApiScope: runtime.entraApiScope || import.meta.env.VITE_ENTRA_API_SCOPE || "",
  azureMapsClientId: runtime.azureMapsClientId || import.meta.env.VITE_AZURE_MAPS_CLIENT_ID || "",
  featureFlags: runtime.featureFlags || {},
};

export function runtimeFeatureEnabled(name: string, fallback = false) {
  const value = runtimeConfig.featureFlags[name];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  if (typeof value === "number") return value !== 0;
  return fallback;
}
