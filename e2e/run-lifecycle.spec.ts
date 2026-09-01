import { expect, test, type Page, type Route } from '@playwright/test';

const orderId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const driverId = '33333333-3333-4333-8333-333333333333';
const vehicleId = '44444444-4444-4444-8444-444444444444';
const trailerId = '55555555-5555-4555-8555-555555555555';
const collectStopId = '66666666-6666-4666-8666-666666666666';
const deliveryStopId = '77777777-7777-4777-8777-777777777777';

type State = {
  runCreated: boolean;
  allocatedPallets: number;
  driverAssigned: boolean;
  vehicleAssigned: boolean;
  trailerAssigned: boolean;
  geofenceStage: 0 | 1 | 2 | 3;
  planningDate: string;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function isoDate(value = new Date()) { return value.toISOString().slice(0, 10); }
function atOffset(minutes: number) { return new Date(Date.now() + minutes * 60_000).toISOString(); }
function runReference(date: string) { return `RUN-${date.replaceAll('-', '')}-01`; }

function canonicalRun(state: State) {
  return {
    id: runId,
    reference: runReference(state.planningDate),
    rawReference: runReference(state.planningDate),
    planningDate: state.planningDate,
    status: state.geofenceStage === 3 ? 'Completed' : state.driverAssigned ? 'Dispatched' : 'Planned',
    vehicleId: state.vehicleAssigned ? vehicleId : null,
    driverId: state.driverAssigned ? driverId : null,
    trailerId: state.trailerAssigned ? trailerId : null,
    palletSpacesUsed: state.allocatedPallets,
    totalPalletSpaces: 26,
    capacityType: 'Standard pallets',
    plannerNotes: 'Planner period: AM',
    stops: [
      { id: collectStopId, sequence: 1, name: 'Collect · Hall Hunter', address: 'Hall Hunter Farm', plannedArrivalUtc: atOffset(20) },
      { id: deliveryStopId, orderId, sequence: 2, name: 'Deliver · Leyland', address: 'Waitrose Leyland', plannedArrivalUtc: atOffset(90) },
    ],
  };
}

function progressRecord(state: State) {
  const run = canonicalRun(state);
  const firstState = state.geofenceStage === 0 ? 'EnRoute' : state.geofenceStage === 1 ? 'OnSite' : 'Departed';
  const secondState = state.geofenceStage === 3 ? 'Departed' : 'EnRoute';
  const currentVisit = state.geofenceStage === 1 ? {
    geofenceName: 'Hall Hunter', loadStopId: collectStopId, enteredAtUtc: atOffset(-5), siteArrivalUtc: atOffset(-5),
    dwellMinutes: 5, liveDwellMinutes: 5, liveDwellSeconds: 300, waitLimitMinutes: 60, isDelayed: false,
    status: 'OnSite', statusReason: 'RoadTech geofence ENTER',
  } : null;
  return {
    loadId: runId,
    loadReference: run.reference,
    loadStatus: run.status,
    runState: state.geofenceStage === 3 ? 'Completed' : state.geofenceStage === 1 ? 'Arrived' : state.geofenceStage >= 2 ? 'BetweenStops' : 'Planned',
    totalStops: 2,
    completedStops: state.geofenceStage === 3 ? 2 : state.geofenceStage >= 2 ? 1 : 0,
    progressPercent: state.geofenceStage === 3 ? 100 : state.geofenceStage >= 2 ? 50 : 0,
    nextStop: state.geofenceStage === 3 ? null : state.geofenceStage >= 2
      ? run.stops[1]
      : run.stops[0],
    currentVisit,
    lastDeparture: state.geofenceStage >= 2 ? { loadStopId: collectStopId, exitedAtUtc: atOffset(-1), dwellMinutes: 8 } : null,
    stopDwell: [
      { stopId: collectStopId, sequence: 1, stopName: 'Collect · Hall Hunter', state: firstState },
      { stopId: deliveryStopId, sequence: 2, stopName: 'Deliver · Leyland', state: secondState },
    ],
    phase: state.geofenceStage === 3 ? 'Complete' : state.geofenceStage === 1 ? 'On site' : state.geofenceStage >= 2 ? 'Heading to' : 'Next job',
    focusStop: state.geofenceStage === 3 ? 'Leyland' : state.geofenceStage === 1 ? 'Hall Hunter' : state.geofenceStage >= 2 ? 'Leyland' : 'Hall Hunter',
    geofenceOnSite: state.geofenceStage === 1,
    trackingFresh: true,
    trackingMoving: state.geofenceStage === 0 || state.geofenceStage === 2,
    ignitionOn: state.geofenceStage !== 1 && state.geofenceStage !== 3,
    driverCardPresent: state.driverAssigned,
    trackingAgeSeconds: 15,
    speedKph: state.geofenceStage === 0 || state.geofenceStage === 2 ? 42 : 0,
    tacho: { status: 'Matched', driverName: 'E2E Driver', signOnUtc: atOffset(-30), explanation: 'E2E matched duty' },
  };
}

async function installApi(page: Page, state: State) {
  await page.route('**/tms-api/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/tms-api/, '');
    const method = request.method();
    const requestedDate = url.searchParams.get('date');
    if (requestedDate) state.planningDate = requestedDate;

    if (path === '/api/v1/planning-control/pallets' && method === 'GET') {
      const allocations = state.allocatedPallets > 0 ? [{ loadId: runId, loadReference: runReference(state.planningDate), pallets: state.allocatedPallets }] : [];
      return json(route, {
        date: state.planningDate,
        generatedAtUtc: new Date().toISOString(),
        orders: [{
          id: orderId, reference: 'E2E-ORDER-1', customerCode: 'HHP', orderedPallets: 4,
          plannedPallets: state.allocatedPallets, outstandingPallets: Math.max(4 - state.allocatedPallets, 0),
          collection: 'Hall Hunter', destination: 'Leyland', allocations,
        }],
        summary: { ordered: 4, planned: state.allocatedPallets, outstanding: Math.max(4 - state.allocatedPallets, 0) },
      });
    }
    if ((path === '/api/v1/runs' || path === '/api/v1/loads') && method === 'GET') return json(route, state.runCreated ? [canonicalRun(state)] : []);
    if (path === '/api/v1/sites' && method === 'GET') return json(route, [
      { id: '88888888-8888-4888-8888-888888888888', externalCode: 'HALL', name: 'Hall Hunter', collectionAddress: 'Hall Hunter Farm', latitude: 50.9, longitude: -1.0, active: true },
      { id: '99999999-9999-4999-8999-999999999999', externalCode: 'LEY', name: 'Leyland', collectionAddress: 'Waitrose Leyland', latitude: 53.7, longitude: -2.7, active: true },
    ]);
    if (path === '/api/v1/runs' && method === 'POST') {
      state.runCreated = true;
      return json(route, canonicalRun(state), 201);
    }
    if (path === '/api/v1/planning-control/allocations' && method === 'POST') {
      const body = request.postDataJSON() as { pallets: number };
      state.allocatedPallets = body.pallets;
      return json(route, { orderId, loadId: runId, allocatedToRun: body.pallets, plannedPallets: body.pallets, orderedPallets: 4, outstandingPallets: Math.max(4 - body.pallets, 0), overplannedPallets: 0 });
    }
    if (/^\/api\/v1\/runs\/.+\/stops$/.test(path) && method === 'PUT') return json(route, canonicalRun(state));
    if (/^\/api\/v1\/loads\/.+\/utilisation$/.test(path) && method === 'PUT') return json(route, canonicalRun(state));
    if (path.startsWith('/api/v1/planning/geofence-linkage') && method === 'GET') return json(route, { planningDate: state.planningDate, warnings: [], records: [] });
    if (path.startsWith('/api/v1/planning-optimiser') && method === 'GET') return json(route, { proposals: [] });
    if (path.startsWith('/api/v1/planning-intelligence/loads/') && method === 'GET') return json(route, { loadId: runId, warnings: [], recommendations: [] });
    if (path.startsWith('/api/v1/operational-master-data/vehicles/search') && method === 'GET') return json(route, []);

    if (path === '/api/v1/driver-dispatch' && method === 'GET') return json(route, {
      planningDate: state.planningDate,
      drivers: [{ driverId, employeeNumber: 'D001', displayName: 'E2E Driver', driverType: 'Employed', dayNumber: 1, assignedLoadId: state.driverAssigned ? runId : undefined, suggestedRunReference: runReference(state.planningDate) }],
      loads: state.runCreated ? [canonicalRun(state)] : [],
      vehicles: [{ id: vehicleId, registration: 'AB12 CDE', fleetNumber: 'E2E-1', active: true }],
      trailers: [{ id: trailerId, trailerNumber: 'TRL-101', type: 'Curtainsider', active: true }],
    });
    if (/^\/api\/v1\/driver-dispatch\/.+\/allocation$/.test(path) && method === 'PUT') {
      const body = request.postDataJSON() as { vehicleId?: string | null; trailerId?: string | null };
      state.driverAssigned = true;
      if (body.vehicleId) state.vehicleAssigned = true;
      if (body.trailerId) state.trailerAssigned = true;
      return json(route, { ok: true });
    }
    if (/^\/api\/v1\/runs\/.+\/dispatch$/.test(path) && method === 'GET') return json(route, {
      reference: runReference(state.planningDate), planningDate: state.planningDate, status: canonicalRun(state).status,
      driver: { displayName: 'E2E Driver', employeeNumber: 'D001', mobileNumber: '07000000000' },
      vehicle: { registration: 'AB12 CDE', fleetNumber: 'E2E-1' }, trailer: { trailerNumber: 'TRL-101', type: 'Curtainsider' },
      stops: canonicalRun(state).stops.map(stop => ({ sequence: stop.sequence, name: stop.name, address: stop.address })),
    });
    if (/^\/api\/v1\/runs\/.+\/route$/.test(path) && method === 'GET') return json(route, { loadId: runId, route: 'Hall Hunter → Leyland' });

    if (path === '/api/v1/tv-display/planned-runs' && method === 'GET') return json(route, state.runCreated ? [canonicalRun(state)] : []);
    if (path === '/api/v1/driver-assignments' && method === 'GET') return json(route, state.runCreated ? [{
      loadId: runId, planningDate: state.planningDate, loadReference: runReference(state.planningDate), status: canonicalRun(state).status,
      driver: state.driverAssigned ? { id: driverId, displayName: 'E2E Driver', employeeNumber: 'D001' } : undefined,
      vehicle: state.vehicleAssigned ? { id: vehicleId, registration: 'AB12 CDE', fleetNumber: 'E2E-1' } : undefined,
      trailerNumber: state.trailerAssigned ? 'TRL-101' : undefined, stopCount: 2, finalStop: 'Leyland',
    }] : []);
    if (path === '/api/v1/operations/delivery-etas' && method === 'GET') return json(route, {
      planningDate: state.planningDate, calculatedAtUtc: new Date().toISOString(), records: state.runCreated ? [{
        loadId: runId, loadReference: runReference(state.planningDate), loadStatus: canonicalRun(state).status, stopId: deliveryStopId,
        sequence: 2, stopName: 'Deliver · Leyland', orderReference: 'E2E-ORDER-1', customerCode: 'HHP', vehicleRegistration: state.vehicleAssigned ? 'AB12 CDE' : undefined,
        etaUtc: atOffset(80), source: 'Live', deliveryWindowEndUtc: atOffset(120), risk: 'OnTrack', trackingUpdatedAtUtc: new Date().toISOString(),
      }] : [],
    });
    if (path === '/api/v1/run-progress' && method === 'GET') return json(route, {
      planningDate: state.planningDate, calculatedAtUtc: new Date().toISOString(), count: state.runCreated ? 1 : 0,
      geofenceAvailable: true, geofenceCount: 2, geofenceLinkedRuns: state.runCreated ? 1 : 0, latestTrackingUtc: new Date().toISOString(), warning: '',
      records: state.runCreated ? [progressRecord(state)] : [],
    });
    if (path === '/api/v1/tv-display/route-progress' && method === 'GET') return json(route, {
      latestTrackingUtc: new Date().toISOString(), geofenceLinkedRuns: state.runCreated ? 1 : 0, runs: state.runCreated ? [{
        loadId: runId, reference: runReference(state.planningDate), totalStops: 2,
        completedStops: state.geofenceStage === 3 ? 2 : state.geofenceStage >= 2 ? 1 : 0,
        phase: progressRecord(state).phase, truckPositionPercent: state.geofenceStage === 3 ? 100 : state.geofenceStage >= 2 ? 60 : 20,
        focusStop: progressRecord(state).focusStop, geofenceOnSite: state.geofenceStage === 1, trackingFresh: true,
        stops: canonicalRun(state).stops.map((stop, index) => ({ ...stop, state: index === 0 ? (state.geofenceStage >= 2 ? 'Departed' : state.geofenceStage === 1 ? 'OnSite' : 'EnRoute') : state.geofenceStage === 3 ? 'Departed' : 'EnRoute' })),
      }] : [],
    });
    if (path === '/api/v1/run-timing' && method === 'GET') return json(route, {
      planningDate: state.planningDate, records: state.runCreated ? [{
        loadId: runId, loadReference: runReference(state.planningDate), completed: state.geofenceStage === 3,
        finalEtaUtc: atOffset(80), finalEtaSource: 'GeofenceEstimated', finalDestinationStopId: deliveryStopId, finalDestinationName: 'Leyland',
      }] : [],
    });

    return json(route, {});
  });
}

test('planner → dispatch → geofence arrival/departure → completion stays coherent', async ({ page }) => {
  const state: State = { runCreated: false, allocatedPallets: 0, driverAssigned: false, vehicleAssigned: false, trailerAssigned: false, geofenceStage: 0, planningDate: isoDate() };
  await installApi(page, state);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Available now' })).toBeVisible();
  await page.getByRole('button', { name: /Hall Hunter.*4.*Leyland/i }).click();
  await expect(page.getByText(/4 pallets added and auto-saved/i)).toBeVisible();
  expect(state.runCreated).toBe(true);
  expect(state.allocatedPallets).toBe(4);

  await page.getByRole('link', { name: 'Driver Dispatch' }).first().click();
  await expect(page.getByRole('heading', { name: 'Driver Dispatch' })).toBeVisible();
  const runInput = page.getByPlaceholder('Run…');
  await runInput.fill('RUN-');
  await page.getByRole('button', { name: new RegExp(runReference(state.planningDate), 'i') }).click();
  await expect(page.getByText('Allocation saved.')).toBeVisible();

  const vehicleInput = page.getByPlaceholder('Vehicle…');
  await vehicleInput.fill('AB12');
  await page.getByRole('button', { name: /AB12 CDE/ }).click();
  await expect(page.getByText('Allocation saved.')).toBeVisible();
  const trailerInput = page.getByPlaceholder('Trailer…');
  await trailerInput.fill('TRL');
  await page.getByRole('button', { name: /TRL-101/ }).click();
  await expect(page.getByText('Allocation saved.')).toBeVisible();
  expect(state.driverAssigned && state.vehicleAssigned && state.trailerAssigned).toBe(true);

  await page.getByRole('link', { name: 'Operations Wallboard' }).click();
  await expect(page.getByRole('heading', { name: 'Arrivals & Departures' })).toBeVisible();
  await expect(page.getByText(/AB12 CDE/).first()).toBeVisible();

  state.geofenceStage = 1;
  await page.reload();
  await expect(page.getByText('ON SITE').first()).toBeVisible();
  await expect(page.getByText(/Hall Hunter/).first()).toBeVisible();

  state.geofenceStage = 2;
  await page.reload();
  await expect(page.getByText(/1 of 2 geofences exited/i)).toBeVisible();

  state.geofenceStage = 3;
  await page.reload();
  await expect(page.getByText('AVAILABLE').first()).toBeVisible();
  await expect(page.getByText(/2 of 2 geofences exited/i)).toBeVisible();
});
