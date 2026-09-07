import { expect, test, type Page, type Route } from '@playwright/test';

const planningDate = new Date().toISOString().slice(0, 10);
const runReference = (date: string) => `RUN-${date.replaceAll('-', '')}-1`;

let state = {
  planningDate,
  runCreated: false,
  allocatedPallets: 0,
  driverAssigned: false,
  vehicleAssigned: false,
  trailerAssigned: false,
  geofenceStage: 0,
};

const driverId = '11111111-1111-1111-1111-111111111111';
const vehicleId = '22222222-2222-2222-2222-222222222222';
const trailerId = '33333333-3333-3333-3333-333333333333';
const orderId = '44444444-4444-4444-4444-444444444444';
const loadId = '55555555-5555-5555-5555-555555555555';
const siteId = '66666666-6666-6666-6666-666666666666';

function response(route: Route, data: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
}

async function mockApi(page: Page) {
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/v1/sites') return response(route, [{ id: siteId, externalCode: 'SELSEY', name: 'Selsey', driverTextName: 'Selsey', collectionAddress: 'Selsey, UK', active: true }]);
    if (path === '/api/v1/market-contacts') return response(route, []);
    if (path === '/api/v1/vehicles') return response(route, [{ id: vehicleId, registration: 'AB12 CDE', fleetNumber: '101', active: true }]);
    if (path === '/api/v1/trailers') return response(route, [{ id: trailerId, trailerNumber: 'TRL-101', type: 'Curtainsider', standardCapacity: 26, euroCapacity: 33, active: true }]);
    if (path === '/api/v1/drivers') return response(route, [{ id: driverId, employeeNumber: 'EMP1', displayName: 'Test Driver', active: true }]);
    if (path === '/api/v1/driver-master/tachomaster/sync' && method === 'POST') return response(route, { message: 'Synced' });
    if (path === '/api/v1/driver-dispatch-status') return response(route, { planningDate: state.planningDate, drivers: [{ driverId, dispatchStatus: state.driverAssigned ? 'Awaiting Dispatch' : 'No Run', weeklyRestStatus: 'Ready', weeklyRestMessage: 'Ready' }] });
    if (path === '/api/v1/driver-dispatch') {
      const loads = state.runCreated ? [{ id: loadId, reference: runReference(state.planningDate), rawReference: runReference(state.planningDate), planningDate: state.planningDate, status: state.driverAssigned ? 'Planned' : 'Draft', driverId: state.driverAssigned ? driverId : null, vehicleId: state.vehicleAssigned ? vehicleId : null, trailerId: state.trailerAssigned ? trailerId : null, palletSpacesUsed: state.allocatedPallets, totalPalletSpaces: 26, capacityType: 'Standard pallets', southbound: false, stops: [{ id: 'stop-1', sequence: 1, name: 'Collect · Selsey', address: 'Selsey, UK', latitude: 50.7, longitude: -0.8 }, { id: 'stop-2', sequence: 2, name: 'Deliver · Test Depot', address: 'Test Depot, UK', latitude: 51.1, longitude: -0.2 }] }] : [];
      return response(route, {
        planningDate: state.planningDate,
        leaveSource: 'Test',
        drivers: [{ driverId, employeeNumber: 'EMP1', displayName: 'Test Driver', driverType: 'Employed', dayNumber: 1, onLeave: false, assignedLoadId: state.driverAssigned ? loadId : null, assignedRunCount: state.driverAssigned ? 1 : 0 }],
        vehicles: [{ id: vehicleId, registration: 'AB12 CDE', fleetNumber: '101', active: true }],
        trailers: [{ id: trailerId, trailerNumber: 'TRL-101', type: 'Curtainsider', standardCapacity: 26, euroCapacity: 33, active: true }],
        loads,
      });
    }
    if (path === `/api/v1/runs/${loadId}/allocation` && method === 'PUT') {
      const body = request.postDataJSON();
      state.driverAssigned = body.driverId === driverId;
      state.vehicleAssigned = body.vehicleId === vehicleId;
      state.trailerAssigned = body.trailerId === trailerId;
      return response(route, { id: loadId, reference: runReference(state.planningDate), rawReference: runReference(state.planningDate), planningDate: state.planningDate, status: 'Planned', driverId: body.driverId, vehicleId: body.vehicleId, trailerId: body.trailerId, southbound: false, stops: [] });
    }
    if (path === '/api/v1/planning-control' || path === '/api/v1/planning-control/state') {
      return response(route, {
        planningDate: state.planningDate,
        orders: [{ id: orderId, reference: 'PO-1001', customerCode: 'TEST', collectionDate: state.planningDate, deliveryDate: state.planningDate, pallets: 4, allocatedPallets: state.allocatedPallets, outstandingPallets: Math.max(0, 4 - state.allocatedPallets), status: 'Approved', collectionSite: 'Selsey', deliverySite: 'Test Depot', palletType: 'Standard' }],
        runs: state.runCreated ? [{ id: loadId, reference: runReference(state.planningDate), planningDate: state.planningDate, status: state.driverAssigned ? 'Planned' : 'Draft', driverId: state.driverAssigned ? driverId : null, vehicleId: state.vehicleAssigned ? vehicleId : null, trailerId: state.trailerAssigned ? trailerId : null, palletSpacesUsed: state.allocatedPallets, totalPalletSpaces: 26, capacityType: 'Standard pallets', stops: [{ id: 'stop-1', sequence: 1, name: 'Collect · Selsey', address: 'Selsey, UK', latitude: 50.7, longitude: -0.8 }, { id: 'stop-2', sequence: 2, name: 'Deliver · Test Depot', address: 'Test Depot, UK', latitude: 51.1, longitude: -0.2 }] }] : [],
      });
    }
    if (path === '/api/v1/planning-control/runs' && method === 'POST') {
      state.runCreated = true;
      return response(route, { id: loadId, reference: runReference(state.planningDate), planningDate: state.planningDate, status: 'Draft', palletSpacesUsed: 0, totalPalletSpaces: 26, capacityType: 'Standard pallets', stops: [] });
    }
    if (path === `/api/v1/planning-control/runs/${loadId}/allocate` && method === 'POST') {
      const body = request.postDataJSON();
      state.allocatedPallets += Number(body.pallets || 0);
      return response(route, { applied: Number(body.pallets || 0) });
    }
    if (path.includes('/planning-control/runs/') && path.endsWith('/stops') && method === 'PUT') return response(route, {});
    if (path === `/api/v1/runs/${loadId}/operational` && method === 'PUT') return response(route, {});
    if (path === '/api/v1/planning-control/activity') return response(route, []);
    if (path === '/api/v1/planning-control/refresh') return response(route, {});
    if (path === '/api/v1/runs') return response(route, state.runCreated ? [{ id: loadId, reference: runReference(state.planningDate), planningDate: state.planningDate, status: state.driverAssigned ? 'Planned' : 'Draft', driverId: state.driverAssigned ? driverId : null, vehicleId: state.vehicleAssigned ? vehicleId : null, trailerId: state.trailerAssigned ? trailerId : null, palletSpacesUsed: state.allocatedPallets, totalPalletSpaces: 26, capacityType: 'Standard pallets', stops: [{ id: 'stop-1', sequence: 1, name: 'Collect · Selsey', address: 'Selsey, UK', latitude: 50.7, longitude: -0.8 }, { id: 'stop-2', sequence: 2, name: 'Deliver · Test Depot', address: 'Test Depot, UK', latitude: 51.1, longitude: -0.2 }] }] : []);
    if (path === '/api/v1/operations-wallboard') {
      const status = state.geofenceStage >= 2 ? 'Completed' : state.driverAssigned ? 'Planned' : 'Draft';
      return response(route, { planningDate: state.planningDate, generatedAtUtc: new Date().toISOString(), rows: state.runCreated ? [{ loadId, runReference: runReference(state.planningDate), status, vehicleRegistration: state.vehicleAssigned ? 'AB12 CDE' : null, driverName: state.driverAssigned ? 'Test Driver' : null, stops: [{ stopId: 'stop-1', sequence: 1, name: 'Collect · Selsey', geofenceState: state.geofenceStage === 0 ? 'Expected' : state.geofenceStage === 1 ? 'Arrived' : 'Departed', arrivedAtUtc: state.geofenceStage >= 1 ? new Date().toISOString() : null, departedAtUtc: state.geofenceStage >= 2 ? new Date().toISOString() : null }, { stopId: 'stop-2', sequence: 2, name: 'Deliver · Test Depot', geofenceState: state.geofenceStage >= 2 ? 'Completed' : 'Expected' }] }] : [] });
    }
    if (path === '/api/v1/fleet-status') return response(route, { vehicleCount: 1, readyCount: state.vehicleAssigned ? 1 : 0, attentionCount: 0, vehicles: [{ vehicleId, registration: 'AB12 CDE', fleetNumber: '101', condition: state.vehicleAssigned ? 'SignedOn' : 'NotSignedOn', loadReference: state.runCreated ? runReference(state.planningDate) : null, driverName: state.driverAssigned ? 'Test Driver' : null, loadStatus: state.driverAssigned ? 'Planned' : 'Draft' }] });
    if (path === '/api/v1/driver-assignments') return response(route, []);
    if (path === '/api/v1/delivery-etas') return response(route, { records: [] });
    if (path === '/api/v1/staging') return response(route, []);
    if (path === '/api/v1/orders') return response(route, [{ id: orderId, poNumber: 'PO-1001', customerCode: 'TEST', collectionDate: state.planningDate, deliveryDate: state.planningDate, pallets: 4, status: 'Approved' }]);
    if (path === '/api/v1/telemetry') return response(route, { records: [] });
    if (path === '/api/v1/customers') return response(route, []);
    if (path === '/api/v1/customer-contacts') return response(route, []);
    if (path === '/api/v1/diagnostics/tables') return response(route, {});
    if (path === '/api/v1/fuel-prices') return response(route, []);
    if (path === '/api/v1/integration/status') return response(route, {});
    if (path === '/api/v1/sage-hr/status') return response(route, {});
    if (path === '/api/v1/fleetio/status') return response(route, {});
    if (path === '/api/v1/fleetio/vehicle-alignment') return response(route, { connected: false, matched: 0, missingInFleetio: 0, unmatchedFleetio: 0, records: [], message: 'Not configured' });
    if (path.startsWith('/api/v1/intelligence/')) return response(route, {});
    if (path.includes('/driver-dispatch-routes/')) return response(route, { routes: [{ summary: { travelTimeInSeconds: 3600 } }] });
    if (path.endsWith('/dispatch-readiness') && method === 'POST') return response(route, { canDispatch: true });
    if (path.endsWith('/dispatch')) return response(route, { reference: runReference(state.planningDate), driver: { displayName: 'Test Driver', employeeNumber: 'EMP1', mobileNumber: '07123456789' }, vehicle: { registration: 'AB12 CDE', fleetNumber: '101' }, trailer: { trailerNumber: 'TRL-101', type: 'Curtainsider' }, stops: [] });
    if (path.includes('/driver-message/sms') && method === 'POST') return response(route, {});
    return response(route, {});
  });
}

test.beforeEach(async ({ page }) => {
  state = { planningDate, runCreated: false, allocatedPallets: 0, driverAssigned: false, vehicleAssigned: false, trailerAssigned: false, geofenceStage: 0 };
  await mockApi(page);
});

test('planner → dispatch → geofence arrival/departure → completion stays coherent', async ({ page }) => {
  await page.goto(`/?date=${state.planningDate}`);
  await expect(page.getByRole('heading', { name: /Run Planner/i })).toBeVisible();

  await page.getByRole('button', { name: /Create run/i }).click();
  await expect(page.getByText(new RegExp(runReference(state.planningDate), 'i')).first()).toBeVisible();
  expect(state.runCreated).toBe(true);

  await page.getByText('PO-1001', { exact: true }).click();
  await expect(page.getByText(/4 pallets added and auto-saved/i)).toBeVisible();
  expect(state.runCreated).toBe(true);
  expect(state.allocatedPallets).toBe(4);

  await page.getByRole('link', { name: 'Driver Dispatch' }).first().click();
  await expect(page.getByRole('heading', { name: 'Driver Dispatch' })).toBeVisible();
  const runInput = page.getByPlaceholder('Run…');
  await runInput.fill('RUN-');
  await page.getByRole('button', { name: new RegExp(runReference(state.planningDate), 'i') }).click();

  const vehicleInput = page.getByRole('combobox', { name: 'Vehicle…' });
  await vehicleInput.fill('AB12');
  await page.getByRole('button', { name: /AB12 CDE/ }).click();
  const trailerInput = page.getByRole('combobox', { name: 'Trailer…' });
  await trailerInput.fill('TRL');
  await page.getByRole('button', { name: /TRL-101/ }).click();
  await page.getByRole('button', { name: 'Allocate', exact: true }).click();
  await expect(page.getByText('Allocation saved. Run is ready for dispatch.', { exact: true })).toBeVisible();
  expect(state.driverAssigned && state.vehicleAssigned && state.trailerAssigned).toBe(true);

  await page.getByRole('link', { name: 'Operations Wallboard' }).click();
  await expect(page.getByRole('heading', { name: 'Arrivals & Departures' })).toBeVisible();
  await expect(page.getByText(/AB12 CDE/).first()).toBeVisible();

  state.geofenceStage = 1;
  await page.reload();
  await expect(page.getByText(/Arrived/i).first()).toBeVisible();

  state.geofenceStage = 2;
  await page.reload();
  await expect(page.getByText(/Completed/i).first()).toBeVisible();
});
