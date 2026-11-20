
import { describe, expect, it } from 'vitest';

import {
  detectEncounters,
} from '../detection/domain/encounter-detector.js';

import {
  createRoadNetwork,
  distanceMeters,
} from '../simulation/domain/road-network.js';

import {
  advanceSimulation,
} from '../simulation/domain/simulation.js';

import type {
  GeoPosition,
} from '../vehicles/domain/vehicle.js';

import type {
  DrivingRoute,
} from './osrm-client.js';

import {
  buildRoadScenario,
  type RoutedVehicle,
} from './route-scenario.js';

const A = {
  latitude: 39.683,
  longitude: -75.751,
};

const B = {
  latitude: 39.683,
  longitude: -75.75,
};

const C = {
  latitude: 39.683,
  longitude: -75.749,
};

const SOUTH = {
  latitude: 39.682,
  longitude: -75.75,
};

const NORTH = {
  latitude: 39.684,
  longitude: -75.75,
};

const PARALLEL_START = {
  latitude: 39.6833,
  longitude: -75.751,
};

const PARALLEL_END = {
  latitude: 39.6833,
  longitude: -75.749,
};

/**
 * Construct a DrivingRoute with the same structure
 * the OSRM client returns, but without network calls.
 */
function makeRoute(
  routeId: string,
  points: readonly GeoPosition[],
): DrivingRoute {
  const segments = points.slice(1).map((point, index) => ({
    id: `${routeId}:${index}`,
    points: [points[index], point],
  }));

  const totalDistance = segments.reduce(
    (sum, segment) =>
      sum +
      distanceMeters(
        segment.points[0],
        segment.points[1],
      ),
    0,
  );

  return {
    distanceMeters: totalDistance,
    durationSeconds: totalDistance / 12,
    coordinates: points.map(
      (point) =>
        [point.longitude, point.latitude] as const,
    ),
    roadNetwork: createRoadNetwork(segments),
    segmentIds: segments.map((segment) => segment.id),
    snappedStart: { ...points[0] },
    snappedEnd: { ...points[points.length - 1] },
  };
}

const emergency: RoutedVehicle = {
  id: 'AMB-001',
  kind: 'EMERGENCY',
  speedMps: 15,
  route: makeRoute('amb', [A, B, C]),
};

const civilian: RoutedVehicle = {
  id: 'CAR-001',
  kind: 'CIVILIAN',
  speedMps: 20,
  route: makeRoute('car1', [SOUTH, B, NORTH]),
};

const secondCivilian: RoutedVehicle = {
  id: 'CAR-002',
  kind: 'CIVILIAN',
  speedMps: 15,
  route: makeRoute(
    'car2',
    [PARALLEL_START, PARALLEL_END],
  ),
};

describe('buildRoadScenario', () => {
  it('merges independently routed vehicles', () => {
    const result = buildRoadScenario([
      emergency,
      civilian,
    ]);

    expect(result.network.size).toBe(4);
    expect(result.simulation.timeMs).toBe(0);
    expect(result.simulation.vehicles).toHaveLength(2);

    expect(
      result.simulation.vehicles[0].vehicle.position,
    ).toEqual(A);

    expect(
      result.simulation.vehicles[1].vehicle.position,
    ).toEqual(SOUTH);
  });

  it('preserves each vehicle route', () => {
    const result = buildRoadScenario([
      emergency,
      civilian,
    ]);

    expect(
      result.simulation.vehicles[0].route,
    ).toEqual(['amb:0', 'amb:1']);

    expect(
      result.simulation.vehicles[1].route,
    ).toEqual(['car1:0', 'car1:1']);
  });

  it('supports an emergency vehicle and two civilians', () => {
    const result = buildRoadScenario([
      emergency,
      civilian,
      secondCivilian,
    ]);

    expect(result.simulation.vehicles).toHaveLength(3);
    expect(result.network.size).toBe(5);
    expect(result.routes).toHaveLength(3);
  });

  it('preserves OSRM longitude-latitude coordinates', () => {
    const result = buildRoadScenario([
      emergency,
      civilian,
    ]);

    expect(result.routes[0].vehicleId).toBe('AMB-001');

    expect(result.routes[0].coordinates).toEqual([
      [-75.751, 39.683],
      [-75.75, 39.683],
      [-75.749, 39.683],
    ]);

    expect(
      result.routes[0].distanceMeters,
    ).toBeGreaterThan(0);

    expect(
      result.routes[0].durationSeconds,
    ).toBeGreaterThan(0);
  });

  it('starts at a specified simulation time', () => {
    const result = buildRoadScenario(
      [emergency, civilian],
      5000,
    );

    expect(result.simulation.timeMs).toBe(5000);

    expect(
      result.simulation.vehicles.every(
        (entry) => entry.vehicle.timestampMs === 5000,
      ),
    ).toBe(true);
  });

  it('advances vehicles using the combined network', () => {
    const result = buildRoadScenario([
      emergency,
      civilian,
    ]);

    const advanced = advanceSimulation(
      result.network,
      result.simulation,
      1000,
    );

    expect(advanced.timeMs).toBe(1000);

    expect(
      advanced.vehicles[0].vehicle.position,
    ).not.toEqual(A);

    expect(
      advanced.vehicles[1].vehicle.position,
    ).not.toEqual(SOUTH);
  });

  it('integrates with the existing encounter detector', () => {
    const result = buildRoadScenario([
      emergency,
      civilian,
      secondCivilian,
    ]);

    const advanced = advanceSimulation(
      result.network,
      result.simulation,
      1000,
    );

    const encounters = detectEncounters(
      {
        network: result.network,
        state: advanced.vehicles[0],
      },
      advanced.vehicles.slice(1).map((state) => ({
        network: result.network,
        state,
      })),
    );

    expect(encounters).toHaveLength(1);

    expect(encounters[0]).toMatchObject({
      emergencyVehicleId: 'AMB-001',
      civilianVehicleId: 'CAR-001',
      reason: 'CROSSING',
    });

    expect(
      encounters[0].etaDifferenceSeconds,
    ).toBeLessThan(1);
  });

  it('rejects a scenario with too few vehicles', () => {
    expect(() =>
      buildRoadScenario([emergency]),
    ).toThrow(RangeError);
  });

  it('rejects a scenario with too many vehicles', () => {
    expect(() =>
      buildRoadScenario([
        emergency,
        civilian,
        secondCivilian,
        {
          ...secondCivilian,
          id: 'CAR-003',
          route: makeRoute(
            'car3',
            [PARALLEL_START, PARALLEL_END],
          ),
        },
      ]),
    ).toThrow(RangeError);
  });

  it('requires exactly one emergency vehicle', () => {
    expect(() =>
      buildRoadScenario([
        civilian,
        secondCivilian,
      ]),
    ).toThrow(/one emergency vehicle/);

    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          kind: 'EMERGENCY',
        },
      ]),
    ).toThrow(/one emergency vehicle/);
  });

  it('rejects duplicate vehicle IDs', () => {
    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          id: 'AMB-001',
        },
      ]),
    ).toThrow(/Duplicate scenario vehicle/);
  });

  it('rejects duplicate road segment IDs', () => {
    const overlappingIds: RoutedVehicle = {
      ...civilian,
      route: makeRoute(
        'amb',
        [SOUTH, B, NORTH],
      ),
    };

    expect(() =>
      buildRoadScenario([
        emergency,
        overlappingIds,
      ]),
    ).toThrow(/Duplicate road segment/);
  });

  it('rejects disconnected directed routes', () => {
    const invalidRoute: DrivingRoute = {
      ...civilian.route,
      roadNetwork: createRoadNetwork([
        {
          id: 'disconnected:0',
          points: [SOUTH, B],
        },
        {
          id: 'disconnected:1',
          points: [NORTH, C],
        },
      ]),
      segmentIds: [
        'disconnected:0',
        'disconnected:1',
      ],
    };

    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          route: invalidRoute,
        },
      ]),
    ).toThrow(/Disconnected route/);
  });

  it('rejects a vehicle starting away from its route', () => {
    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          route: {
            ...civilian.route,
            snappedStart: C,
          },
        },
      ]),
    ).toThrow(/must start at the beginning/);
  });

  it('rejects invalid vehicle speeds', () => {
    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          speedMps: -5,
        },
      ]),
    ).toThrow(RangeError);

    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          speedMps: Infinity,
        },
      ]),
    ).toThrow(RangeError);
  });

  it('allows stationary vehicles', () => {
    const result = buildRoadScenario([
      emergency,
      {
        ...civilian,
        speedMps: 0,
      },
    ]);

    expect(
      result.simulation.vehicles[1].vehicle.speedMps,
    ).toBe(0);
  });

  it('rejects invalid simulation timestamps', () => {
    expect(() =>
      buildRoadScenario(
        [emergency, civilian],
        -1000,
      ),
    ).toThrow(RangeError);
  });

  it('rejects invalid route distance metadata', () => {
    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          route: {
            ...civilian.route,
            distanceMeters: Infinity,
          },
        },
      ]),
    ).toThrow(RangeError);

    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          route: {
            ...civilian.route,
            distanceMeters: 30_000,
          },
        },
      ]),
    ).toThrow(RangeError);
  });

  it('rejects routes without usable segment IDs', () => {
    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          route: {
            ...civilian.route,
            segmentIds: [],
          },
        },
      ]),
    ).toThrow(/road geometry/);
  });

  it('rejects invalid GeoJSON coordinates', () => {
    expect(() =>
      buildRoadScenario([
        emergency,
        {
          ...civilian,
          route: {
            ...civilian.route,
            coordinates: [
              [-75.75, 120],
              [-75.74, 39.68],
            ],
          },
        },
      ]),
    ).toThrow(RangeError);
  });

  it('does not modify the original driving routes', () => {
    const originalEmergencyRoads = [
      ...emergency.route.roadNetwork.keys(),
    ];

    const originalCivilianRoads = [
      ...civilian.route.roadNetwork.keys(),
    ];

    buildRoadScenario([
      emergency,
      civilian,
    ]);

    expect([
      ...emergency.route.roadNetwork.keys(),
    ]).toEqual(originalEmergencyRoads);

    expect([
      ...civilian.route.roadNetwork.keys(),
    ]).toEqual(originalCivilianRoads);
  });
});
