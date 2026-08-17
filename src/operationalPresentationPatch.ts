import { api, type Driver, type FleetStatus, type Vehicle } from './lib/api';

declare global {
  interface Window {
    __slhOperationalPresentationPatch?: boolean;
  }
}

const STATUS_CLASSES = [
  'slh-status-moving',
  'slh-status-active-stationary',
  'slh-status-inactive',
  'slh-status-vor',
] as const;

const normalise = (value: string | undefined) =>
  (value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const formatMinutes = (minutes?: number) => {
  if (minutes == null || !Number.isFinite(minutes)) return undefined;
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}h ${String(safe % 60).padStart(2, '0')}m`;
};

const isVorStatus = (status?: string) => {
  const value = (status || '').trim().toLowerCase().replaceAll('-', ' ');
  return value === 'vor' ||
    value.includes('vehicle off road') ||
    value.includes('out of service');
};

const isVorVehicle = (vehicle: Pick<Vehicle, 'fleetioVor' | 'fleetioStatus'>) =>
  vehicle.fleetioVor === true || isVorStatus(vehicle.fleetioStatus);

const vehiclePresentationClass = (vehicle: FleetStatus['vehicles'][number]) => {
  if (vehicle.fleetioVor === true || isVorStatus(vehicle.fleetioStatus)) return 'slh-status-vor';
  if (vehicle.condition === 'Moving') return 'slh-status-moving';
  if (['Started', 'SignedOn', 'Stationary'].includes(vehicle.condition)) {
    return 'slh-status-active-stationary';
  }
  return 'slh-status-inactive';
};

let latestFleet: FleetStatus | undefined;
let latestDrivers: Driver[] = [];
let latestVehicles: Vehicle[] = [];
let frame: number | undefined;

function applyStatusClass(element: HTMLElement, className: string) {
  for (const item of STATUS_CLASSES) element.classList.remove(item);
  element.classList.add(className);
}

function selectedPlanningDate() {
  const inputs = [
    ...document.querySelectorAll<HTMLInputElement>('.operational-planner input[type="date"], main input[type="date"]'),
  ];
  const visible = inputs.find((input) => input.offsetParent !== null) || inputs[0];
  return visible?.value || localDate();
}

function applyLiveVehicleStates() {
  if (!latestFleet) return;
  const byRegistration = new Map(
    latestFleet.vehicles.map((vehicle) => [normalise(vehicle.registration), vehicle]),
  );

  document.querySelectorAll<HTMLElement>('.rollout-card').forEach((card) => {
    const registration = card.querySelector<HTMLElement>('.rollout-vehicle strong')?.textContent || '';
    const vehicle = byRegistration.get(normalise(registration));
    if (!vehicle) return;
    applyStatusClass(card, vehiclePresentationClass(vehicle));
  });

  document.querySelectorAll<HTMLElement>('.vehicle-detail-panel').forEach((panel) => {
    const registration = panel.querySelector<HTMLElement>('.vehicle-detail-main > div:first-child > strong')?.textContent || '';
    const vehicle = byRegistration.get(normalise(registration));
    if (!vehicle) return;
    applyStatusClass(panel, vehiclePresentationClass(vehicle));
  });
}

function applyVehicleAllocationStates() {
  if (!latestVehicles.length) return;
  const byId = new Map(latestVehicles.map((vehicle) => [vehicle.id, vehicle]));

  document.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
    if (select.options.length === 0 || select.options[0]?.textContent?.trim() !== 'Vehicle') return;

    for (const option of [...select.options].slice(1)) {
      const vehicle = byId.get(option.value);
      if (!vehicle) continue;
      const vor = isVorVehicle(vehicle);
      option.classList.toggle('slh-vor-option', vor);
      option.dataset.slhVor = vor ? 'true' : 'false';
      if (vor) {
        option.disabled = true;
        const status = vehicle.fleetioStatus?.trim();
        const label = `⛔ VOR · ${vehicle.registration}${status && status.toLowerCase() !== 'vor' ? ` · ${status}` : ''}`;
        if (option.textContent !== label) option.textContent = label;
      }
    }
  });
}

function applyDriverPlanningBalances() {
  if (!latestDrivers.length) return;
  const byId = new Map(latestDrivers.map((driver) => [driver.id, driver]));
  const planningDate = selectedPlanningDate();
  const today = localDate();
  const future = planningDate > today;
  const past = planningDate < today;

  document.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
    if (select.options.length === 0 || select.options[0]?.textContent?.trim() !== 'Driver') return;

    for (const option of [...select.options].slice(1)) {
      const driver = byId.get(option.value);
      if (!driver) continue;
      let label = driver.displayName;

      if (!past && !future) {
        const dailyDrive = formatMinutes(driver.tachoDriveAvailableTodayMinutes);
        if (dailyDrive) label += ` · daily drive ${dailyDrive} left`;
      } else if (future) {
        const drive = formatMinutes(driver.tachoDriveAvailableWeekMinutes);
        const work = formatMinutes(driver.tachoWorkAvailableWeekMinutes);
        if (drive || work) {
          label += ` · drive ${drive || '—'} · work ${work || '—'} remaining`;
        } else {
          label += ' · future tacho balance unavailable';
        }
      }

      if (option.textContent !== label) option.textContent = label;
    }
  });
}

function applyFleetAssetVorRows() {
  document.querySelectorAll<HTMLTableRowElement>('table.master-table tbody tr').forEach((row) => {
    const cells = row.querySelectorAll<HTMLTableCellElement>('td');
    if (cells.length < 4) return;
    const status = cells[3]?.textContent || '';
    row.classList.toggle('slh-vor-row', isVorStatus(status));
  });
}

function applyPresentation() {
  frame = undefined;
  applyLiveVehicleStates();
  applyVehicleAllocationStates();
  applyDriverPlanningBalances();
  applyFleetAssetVorRows();
}

function queuePresentation() {
  if (frame != null) return;
  frame = window.requestAnimationFrame(applyPresentation);
}

if (typeof window !== 'undefined' && !window.__slhOperationalPresentationPatch) {
  window.__slhOperationalPresentationPatch = true;

  const originalFleetStatus = api.fleetStatus;
  api.fleetStatus = async (token?: string) => {
    const result = await originalFleetStatus(token);
    latestFleet = result;
    queuePresentation();
    return result;
  };

  const originalDrivers = api.drivers;
  api.drivers = async (token?: string) => {
    const result = await originalDrivers(token);
    latestDrivers = result;
    queuePresentation();
    return result;
  };

  const originalVehicles = api.vehicles;
  api.vehicles = async (token?: string) => {
    const result = await originalVehicles(token);
    latestVehicles = result;
    queuePresentation();
    return result;
  };

  const observer = new MutationObserver(queuePresentation);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('change', queuePresentation, true);
  document.addEventListener('input', queuePresentation, true);
  window.addEventListener('focus', queuePresentation);
}