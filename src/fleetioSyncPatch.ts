import { api, request, type FleetioSync } from './lib/api';

// Keep the existing UI/button contract but route it to the corrected backend
// sync which fetches every Fleetio page and handles trailers separately.
api.syncFleetioVehicles = (token?: string) =>
  request<FleetioSync>('/api/v1/integrations/fleetio/sync-assets', token, {
    method: 'POST',
  });
