
import { describe, expect, it } from 'vitest';

import type {
  GeoPosition,
  VehicleState,
} from '../../vehicles/domain/vehicle.js';

import {
  createRoadNetwork,
  type RoadSegment,
} from '../../simulation/domain/road-network.js';

import {
  createSimulation,
} from '../../simulation/domain/simulation.js';

import {
  detectEncounters,
  type VehicleJourney,
} from './encounter-detector.js';

const A = { latitude: 39.683, longitude: -75.751 };
const B = { latitude: 39.683, longitude: -75.75 };
const C = { latitude: 39.683, longitude: -75.749 };

const S = { latitude: 39.682, longitude: -75.75 };
const N = { latitude: 39.684, longitude: -75.75 };

const P = { latitude: 39.6833, longitude: -75.751 };
const Q = { latitude: 39.6833, longitude: -75.749 };

const S2 = { latitude: 39.681, longitude: -75.75 };

/**
 * Creates a self-contained vehicle journey using our
 * actual road-network and simulation modules.
 */
function journey(
  id: string,
  kind: VehicleState['kind'],
  speedMps: number,
  points: readonly GeoPosition[],
): VehicleJourney {
  const segment: RoadSegment = {
    id: `route-${id}`,
    points,
  };

  const network = createRoadNetwork([segment]);

  const state = createSimulation(network, 0, [
    {
      vehicle: {
        id,
        kind,
        position: points[0],
        speedMps,
        headingDeg: 0,
        timestampMs: 0,
      },
      route: [segment.id],
    },
  ]);

  return {
    network,
    state: state.vehicles[0],
  };
}

const ambulance = () =>
  journey('AMB-001', 'EMERGENCY', 15, [A, B, C]);

const crossingDriver = () =>
  journey('CAR-001', 'CIVILIAN', 20, [S, B, N]);

describe('detectEncounters', () => {
  it('detects vehicles approaching the same crossing', () => {
    const results = detectEncounters(
      ambulance(),
      [crossingDriver()],
    );

    expect(results).toHaveLength(1);

    expect(results[0].emergencyVehicleId).toBe(
      'AMB-001',
    );

    expect(results[0].civilianVehicleId).toBe(
      'CAR-001',
    );

    expect(results[0].reason).toBe('CROSSING');

    expect(results[0].location.latitude).toBeCloseTo(
      B.latitude,
      5,
    );

    expect(
      results[0].etaDifferenceSeconds,
    ).toBeLessThan(1);
  });

  it('ignores an unrelated parallel road', () => {
    const far = journey(
      'CAR-002',
      'CIVILIAN',
      15,
      [P, Q],
    );

    expect(
      detectEncounters(ambulance(), [far]),
    ).toEqual([]);
  });

  it('ignores a driver arriving much later', () => {
    const slow = journey(
      'CAR-003',
      'CIVILIAN',
      1,
      [S, B, N],
    );

    expect(
      detectEncounters(ambulance(), [slow]),
    ).toEqual([]);
  });

  it('ignores an intersection behind the driver', () => {
    const past = journey(
      'CAR-004',
      'CIVILIAN',
      20,
      [
        { latitude: 39.6832, longitude: -75.75 },
        N,
      ],
    );

    expect(
      detectEncounters(ambulance(), [past]),
    ).toEqual([]);
  });

  it('detects a slower driver on a shared road', () => {
    const ahead = journey(
      'CAR-005',
      'CIVILIAN',
      8,
      [B, C],
    );

    const results = detectEncounters(
      ambulance(),
      [ahead],
    );

    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe('SHARED_PATH');
  });

  it('detects a stationary driver on the emergency route', () => {
    const stopped = journey(
      'CAR-006',
      'CIVILIAN',
      0,
      [B, C],
    );

    const results = detectEncounters(
      ambulance(),
      [stopped],
    );

    expect(results).toHaveLength(1);

    expect(results[0].reason).toBe(
      'STATIONARY_ON_PATH',
    );

    expect(results[0].civilianEtaSeconds).toBeNull();
  });

  it('ignores a stationary driver on another road', () => {
    const stopped = journey(
      'CAR-007',
      'CIVILIAN',
      0,
      [P, Q],
    );

    expect(
      detectEncounters(ambulance(), [stopped]),
    ).toEqual([]);
  });

  it('recalculates when a driver changes route', () => {
    const before = crossingDriver();

    const after = journey(
      'CAR-001',
      'CIVILIAN',
      20,
      [S, S2],
    );

    expect(
      detectEncounters(ambulance(), [before]),
    ).toHaveLength(1);

    expect(
      detectEncounters(ambulance(), [after]),
    ).toEqual([]);
  });

  it('evaluates multiple drivers independently', () => {
    const results = detectEncounters(
      ambulance(),
      [
        crossingDriver(),
        journey('CAR-002', 'CIVILIAN', 8, [B, C]),
        journey('CAR-003', 'CIVILIAN', 20, [P, Q]),
      ],
    );

    expect(results).toHaveLength(2);

    const ids = results.map(
      (entry) => entry.civilianVehicleId,
    );

    expect(new Set(ids).size).toBe(2);
  });

  it('respects a shorter prediction horizon', () => {
    expect(
      detectEncounters(
        ambulance(),
        [crossingDriver()],
        { horizonSeconds: 2 },
      ),
    ).toEqual([]);
  });

  it('respects a tighter arrival-time window', () => {
    const late = journey(
      'CAR-008',
      'CIVILIAN',
      14,
      [S, B, N],
    );

    expect(
      detectEncounters(
        ambulance(),
        [late],
        { arrivalWindowSeconds: 0.5 },
      ),
    ).toEqual([]);
  });

  it('ignores an emergency vehicle that is not moving', () => {
    const stopped = journey(
      'AMB-002',
      'EMERGENCY',
      0,
      [A, B, C],
    );

    expect(
      detectEncounters(stopped, [crossingDriver()]),
    ).toEqual([]);
  });

  it('rejects mismatched simulation timestamps', () => {
    const driver = crossingDriver();

    const altered: VehicleJourney = {
      ...driver,
      state: {
        ...driver.state,
        vehicle: {
          ...driver.state.vehicle,
          timestampMs: 1000,
        },
      },
    };

    expect(() =>
      detectEncounters(ambulance(), [altered]),
    ).toThrow(/same simulation time/);
  });

  it('rejects invalid detection options', () => {
    expect(() =>
      detectEncounters(ambulance(), [], {
        arrivalWindowSeconds: -1,
      }),
    ).toThrow(RangeError);
  });

  it('enforces the correct vehicle kinds', () => {
    expect(() =>
      detectEncounters(crossingDriver(), []),
    ).toThrow(/emergency/);

    expect(() =>
      detectEncounters(ambulance(), [ambulance()]),
    ).toThrow(/civilian/);
  });
});
