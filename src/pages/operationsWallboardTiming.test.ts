import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryEta } from '../lib/api';
import { mergeWallboardTiming, type RunTimingRecord } from './operationsWallboardTiming';

function eta(overrides: Partial<DeliveryEta> = {}): DeliveryEta {
  return {
    loadId: 'run-7',
    loadReference: 'Run 7',
    loadStatus: 'InProgress',
    stopId: 'final-stop',
    sequence: 3,
    stopName: 'Deliver · Morrisons-LatimerPark',
    etaUtc: '2026-09-09T13:00:00Z',
    source: 'Live',
    risk: 'Pending',
    deliveryWindowEndUtc: '2026-09-09T18:00:00Z',
    routeDrivingMinutes: 90,
    breakMinutesIncluded: 45,
    tachoStatus: 'BreakIncluded',
    tachoExplanation: '45 minute legal break included',
    ...overrides,
  };
}

function timing(overrides: Partial<RunTimingRecord> = {}): RunTimingRecord {
  return {
    loadId: 'run-7',
    loadReference: 'Run 7',
    completed: false,
    finalEtaUtc: '2026-09-09T12:40:00Z',
    finalEtaSource: 'Geofence',
    finalDestinationStopId: 'final-stop',
    finalDestinationName: 'Morrisons-LatimerPark',
    ...overrides,
  };
}

describe('shared wallboard final ETA', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('combines live geofence/dwell timing with the TachoMaster legal break once', () => {
    const canonical = eta();
    const syntheticTimingRow = eta({
      stopId: 'timing-final-run-7',
      sequence: Number.MAX_SAFE_INTEGER,
      etaUtc: '2026-09-09T12:40:00Z',
      breakMinutesIncluded: 0,
    });

    const result = mergeWallboardTiming(
      [canonical, syntheticTimingRow],
      [timing()],
      new Map(),
      new Map(),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      stopId: 'final-stop',
      etaUtc: '2026-09-09T13:25:00.000Z',
      source: 'Live',
      breakMinutesIncluded: 45,
      isFinalDestination: true,
    });
  });

  it('does not add a future legal break to an actual final-site arrival already in the past', () => {
    const result = mergeWallboardTiming(
      [eta()],
      [timing({ finalEtaUtc: '2026-09-09T11:54:00Z' })],
      new Map(),
      new Map(),
    );

    expect(result[0].etaUtc).toBe('2026-09-09T11:54:00Z');
  });

  it('marks the shared ETA estimated when either route source is approximate', () => {
    const result = mergeWallboardTiming(
      [eta({ source: 'Live', breakMinutesIncluded: 0 })],
      [timing({ finalEtaSource: 'GeofenceEstimated' })],
      new Map(),
      new Map(),
    );

    expect(result[0].source).toBe('Estimated');
  });
});
