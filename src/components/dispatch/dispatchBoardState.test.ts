import { describe, expect, it } from "vitest";
import {
  applyAvailableTimes,
  availableTimesByDriver,
  buildInitialSelections,
  validateLockSelections
} from "./dispatchBoardState";
import type { DispatchDriverDto, DispatchEquipmentWorkbench, DispatchRunDto } from "./types";

function driver(overrides: Partial<DispatchDriverDto> = {}): DispatchDriverDto {
  return {
    driverId: "driver-1",
    driverCode: "SLH001",
    name: "Test Driver",
    employmentType: "Employed",
    skills: "MarketRun",
    holidayDates: [],
    contractedDays: [],
    tachoData: {
      currentDutyDay: 3,
      shiftEndTimeUtc: "2026-09-09T17:00:00Z",
      weeklyWorkingTime: 30,
      dailyDrivingTime: 5,
      breakCompliance: true,
      lastVehicleRegistration: "AB12 CDE",
      requiredRestPeriod: 11,
      reducedDailyRestsUsed: 0
    },
    trackingData: {},
    needsReturn: false,
    isBlocked: false,
    backloadCandidate: false,
    ...overrides
  };
}

function run(overrides: Partial<DispatchRunDto> = {}): DispatchRunDto {
  return {
    runId: "run-1",
    reference: "Run 1",
    collectionPoint: { name: "Barnham" },
    requiredSkills: "MarketRun",
    requiresDoubleDeck: false,
    requiresRefrigerated: false,
    isBackload: false,
    isOvernightMarket: false,
    isSouthbound: false,
    ...overrides
  };
}

function equipment(overrides: Partial<DispatchEquipmentWorkbench> = {}): DispatchEquipmentWorkbench {
  return {
    vehicles: [
      { id: "vehicle-tacho", registration: "AB12CDE", active: true },
      { id: "vehicle-2", registration: "XY99ZZZ", active: true }
    ],
    trailers: [{ id: "trailer-1", trailerNumber: "SLH1", type: "Standard curtainsider", active: true }],
    loads: [],
    ...overrides
  };
}

describe("smart Dispatch board state", () => {
  it("pre-populates a free driver's vehicle from Tacho last-used evidence", () => {
    const selections = buildInitialSelections([driver()], [run()], equipment());
    expect(selections["driver-1"]).toMatchObject({ runId: "", vehicleId: "vehicle-tacho", trailerId: "" });
  });

  it("preserves an existing allocation ahead of the Tacho vehicle suggestion", () => {
    const selections = buildInitialSelections([driver()], [run()], equipment({
      loads: [{ id: "run-1", driverId: "driver-1", vehicleId: "vehicle-2", trailerId: "trailer-1", plannedStartUtc: "2026-09-10T05:00:00Z" }]
    }));
    expect(selections["driver-1"]).toEqual({
      runId: "run-1",
      vehicleId: "vehicle-2",
      trailerId: "trailer-1",
      plannedStartTime: "2026-09-10T05:00:00Z"
    });
  });

  it("reactively applies available-from to rows without overwriting a persisted start", () => {
    const calculated = [{
      driverId: "driver-1",
      availableFrom: "2026-09-10T04:00:00Z",
      requiredRestPeriod: 11,
      weeklyWorkingTimeUsed: 30,
      dailyDrivingTimeUsed: 5,
      wtdStatus: "ok"
    }];

    expect(applyAvailableTimes({ "driver-1": { runId: "run-1", vehicleId: "vehicle-tacho", trailerId: "" } }, calculated)["driver-1"].plannedStartTime)
      .toBe("2026-09-10T04:00:00Z");
    expect(applyAvailableTimes({ "driver-1": { runId: "run-1", vehicleId: "vehicle-tacho", trailerId: "", plannedStartTime: "2026-09-10T06:00:00Z" } }, calculated)["driver-1"].plannedStartTime)
      .toBe("2026-09-10T06:00:00Z");
    expect(availableTimesByDriver(calculated)["driver-1"].requiredRestPeriod).toBe(11);
  });

  it("surfaces lock validation against the exact driver row before calling the API", () => {
    const rows = validateLockSelections(
      [driver()],
      [run()],
      equipment(),
      { "driver-1": { runId: "run-1", vehicleId: "", trailerId: "" } },
      {}
    );

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ driverId: "driver-1", runId: "run-1", reason: "Select a vehicle before locking this run." }),
      expect.objectContaining({ driverId: "driver-1", runId: "run-1", reason: "Get Tacho available times before locking this driver." })
    ]));
  });

  it("blocks a selected start earlier than the Tacho-derived legal availability", () => {
    const times = availableTimesByDriver([{
      driverId: "driver-1",
      availableFrom: "2026-09-10T05:00:00Z",
      requiredRestPeriod: 11,
      weeklyWorkingTimeUsed: 30,
      dailyDrivingTimeUsed: 5,
      wtdStatus: "ok"
    }]);
    const rows = validateLockSelections(
      [driver()],
      [run()],
      equipment(),
      { "driver-1": { runId: "run-1", vehicleId: "vehicle-tacho", trailerId: "", plannedStartTime: "2026-09-10T04:59:00Z" } },
      times
    );

    expect(rows.some(row => row.reason.includes("earlier than the Tacho-derived available-from"))).toBe(true);
  });
});
