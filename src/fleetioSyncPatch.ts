import { api, request, type FleetioSync } from './lib/api';

// Keep legacy Fleetio sync controls on the same resilient full-asset path used
// by Master Data. Core vehicle/trailer saves no longer depend on mapping writes.
api.syncFleetioVehicles = (token?: string) =>
  request<FleetioSync>('/api/v1/integrations/fleetio/sync-assets-resilient', token, {
    method: 'POST',
  });
