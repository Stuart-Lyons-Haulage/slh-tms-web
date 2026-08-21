type FleetVehicleSnapshot = {
  vehicleId: string;
  registration: string;
  fleetNumber?: string;
  trackingIdentifier?: string;
  condition?: string;
  lastEventTimeUtc?: string;
  speedKph?: number;
  ageMinutes?: number;
  driverName?: string;
  driverSource?: string;
  driverMismatch?: boolean;
  allocatedDriverName?: string;
  loadId?: string;
  loadReference?: string;
  loadStatus?: string;
  tacho?: {
    cardNumber?: string;
    dutyStartUtc?: string;
    dutyEndUtc?: string;
    driveMinutes?: number;
    restMinutes?: number;
    driveAvailableTodayMinutes?: number;
    workAvailableWeekMinutes?: number;
  };
};

type LiveVehicleDetail = {
  vehicle: { id: string; registration: string; fleetNumber?: string; abbreviation?: string };
  tracking: {
    state: string;
    lastEventTimeUtc?: string;
    latitude?: number;
    longitude?: number;
    speedKph?: number;
    ageMinutes?: number;
    providerStatus?: string;
  };
  driver: {
    id?: string;
    name?: string;
    maskedTachoCard?: string;
    identityState: string;
    falconName?: string;
    tachoMasterName?: string;
    employeeNumber?: string;
  };
  tacho?: {
    dutyStartUtc: string;
    dutyEndUtc?: string;
    driveMinutes: number;
    restMinutes: number;
    driveAvailableTodayMinutes?: number;
    workAvailableWeekMinutes?: number;
  };
  run?: { id: string; reference: string; status: string };
  geofence?: {
    state: string;
    fenceName?: string;
    enteredAtUtc?: string;
    dwellMinutes?: number;
    latestTrackingUtc?: string;
  };
  compliance: { status: string; message: string };
};

const state: {
  vehicles: FleetVehicleSnapshot[];
  auth?: string;
  apiPrefix?: string;
} = { vehicles: [] };

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await originalFetch(input, init);
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/api/v1/tracking/dot/fleet-status')) {
      const auth = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined)).get('Authorization');
      if (auth) state.auth = auth;
      const marker = '/api/v1/tracking/dot/fleet-status';
      const markerIndex = url.indexOf(marker);
      if (markerIndex >= 0) state.apiPrefix = url.slice(0, markerIndex);
      const payload = await response.clone().json().catch(() => undefined) as { vehicles?: FleetVehicleSnapshot[] } | undefined;
      if (payload?.vehicles) state.vehicles = payload.vehicles;
    }
  } catch {
    // Live tracking must never fail because the optional popup enhancer could not inspect a response.
  }
  return response;
};

function esc(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function when(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function minutes(value?: number) {
  if (value == null) return '—';
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, '0')}m`;
}

function ensurePopup() {
  let root = document.getElementById('slh-live-vehicle-popup');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'slh-live-vehicle-popup';
  root.className = 'live-vehicle-popup-backdrop';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = '<section class="live-vehicle-popup-card"><button type="button" class="live-vehicle-popup-close" aria-label="Close vehicle details">×</button><div class="live-vehicle-popup-content"></div></section>';
  root.addEventListener('click', (event) => {
    if (event.target === root || (event.target as Element).closest('.live-vehicle-popup-close')) root?.remove();
  });
  document.body.appendChild(root);
  return root;
}

function renderSnapshot(vehicle: FleetVehicleSnapshot) {
  const root = ensurePopup();
  const content = root.querySelector('.live-vehicle-popup-content');
  if (!content) return;
  content.innerHTML = `
    <p class="eyebrow">Live vehicle</p>
    <h2>${esc(vehicle.registration)}</h2>
    <div class="live-vehicle-popup-grid">
      <article><span>Driver</span><strong>${esc(vehicle.driverName || 'Awaiting live driver identity')}</strong><small>${esc(vehicle.driverSource || 'DOT/Tacho correlation')}</small></article>
      <article><span>Tracking</span><strong>${esc(vehicle.condition || 'Unknown')}</strong><small>${esc(vehicle.speedKph ?? 0)} km/h · ${esc(vehicle.ageMinutes ?? '—')}m old</small></article>
      <article><span>Tachograph</span><strong>${esc(vehicle.tacho?.cardNumber ? `Card ${vehicle.tacho.cardNumber}` : 'Checking card…')}</strong><small>${vehicle.tacho?.dutyStartUtc ? `Duty from ${esc(when(vehicle.tacho.dutyStartUtc))}` : 'Awaiting duty evidence'}</small></article>
      <article><span>Current run</span><strong>${esc(vehicle.loadReference || 'No active run')}</strong><small>${esc(vehicle.loadStatus || '')}</small></article>
    </div>
    ${vehicle.driverMismatch ? `<p class="live-vehicle-popup-warning">Driver identity differs from planned allocation${vehicle.allocatedDriverName ? ` (${esc(vehicle.allocatedDriverName)})` : ''}.</p>` : ''}
    <p class="live-vehicle-popup-freshness">Last vehicle update ${esc(when(vehicle.lastEventTimeUtc))}</p>`;
}

function renderDetail(detail: LiveVehicleDetail) {
  const root = ensurePopup();
  const content = root.querySelector('.live-vehicle-popup-content');
  if (!content) return;
  const identityClass = detail.driver.identityState === 'Mismatch' ? ' warning' : detail.driver.identityState === 'Confirmed' ? ' confirmed' : '';
  const complianceClass = detail.compliance.status === 'Matched' ? ' confirmed' : detail.compliance.status === 'IdentityMismatch' ? ' warning' : '';
  content.innerHTML = `
    <p class="eyebrow">Live vehicle intelligence</p>
    <h2>${esc(detail.vehicle.registration)}</h2>
    <p class="live-vehicle-popup-subtitle">${esc(detail.vehicle.fleetNumber || detail.vehicle.abbreviation || '')}</p>
    <div class="live-vehicle-popup-grid">
      <article><span>Driver</span><strong>${esc(detail.driver.name || 'No live driver identified')}</strong><small class="identity-state${identityClass}">${esc(detail.driver.identityState)}${detail.driver.maskedTachoCard ? ` · ${esc(detail.driver.maskedTachoCard)}` : ''}</small></article>
      <article><span>Tracking</span><strong>${esc(detail.tracking.state)}</strong><small>${esc(detail.tracking.speedKph ?? 0)} km/h · ${esc(detail.tracking.ageMinutes ?? '—')}m old</small></article>
      <article><span>Tacho duty</span><strong>${detail.tacho ? `Started ${esc(when(detail.tacho.dutyStartUtc))}` : 'No duty returned'}</strong><small>${detail.tacho ? `${esc(minutes(detail.tacho.driveAvailableTodayMinutes))} drive left today` : 'Tracking identity retained without invented duty data'}</small></article>
      <article><span>Current run</span><strong>${esc(detail.run?.reference || 'No active run')}</strong><small>${esc(detail.run?.status || '')}</small></article>
      <article><span>Geofence</span><strong>${esc(detail.geofence?.fenceName || (detail.run ? 'No active fence' : 'No active run'))}</strong><small>${detail.geofence ? `${esc(detail.geofence.state)}${detail.geofence.dwellMinutes != null ? ` · ${esc(detail.geofence.dwellMinutes)}m dwell` : ''}` : 'Geofence progression not applicable'}</small></article>
      <article><span>Compliance evidence</span><strong class="identity-state${complianceClass}">${esc(detail.compliance.status)}</strong><small>${esc(detail.compliance.message)}</small></article>
    </div>
    ${detail.driver.identityState === 'Mismatch' ? '<p class="live-vehicle-popup-warning">DOT/Falcon and TachoMaster card identities disagree. Tacho figures should not be applied to this vehicle until they match.</p>' : ''}
    <div class="live-vehicle-popup-meta">
      <span>Falcon: ${esc(detail.driver.falconName || '—')}</span>
      <span>TachoMaster: ${esc(detail.driver.tachoMasterName || '—')}</span>
      <span>Last communication: ${esc(when(detail.tracking.lastEventTimeUtc))}</span>
      ${detail.geofence?.enteredAtUtc ? `<span>Geofence entered: ${esc(when(detail.geofence.enteredAtUtc))}</span>` : ''}
    </div>`;
}

async function enrich(vehicle: FleetVehicleSnapshot) {
  if (!state.apiPrefix || !state.auth) return;
  try {
    const response = await originalFetch(`${state.apiPrefix}/api/v1/live/vehicles/${encodeURIComponent(vehicle.vehicleId)}/details`, {
      headers: { Accept: 'application/json', Authorization: state.auth },
    });
    if (!response.ok) return;
    renderDetail(await response.json() as LiveVehicleDetail);
  } catch {
    // Keep the instant cached popup if enrichment is unavailable.
  }
}

document.addEventListener('click', (event) => {
  if (window.location.pathname !== '/tracking') return;
  const button = (event.target as Element | null)?.closest('.rollout-select');
  if (!button) return;
  const registration = button.querySelector('.rollout-vehicle strong')?.textContent?.trim();
  if (!registration) return;
  const vehicle = state.vehicles.find(item => item.registration.localeCompare(registration, undefined, { sensitivity: 'base' }) === 0);
  if (!vehicle) return;
  window.setTimeout(() => {
    renderSnapshot(vehicle);
    void enrich(vehicle);
  }, 0);
});

export {};
