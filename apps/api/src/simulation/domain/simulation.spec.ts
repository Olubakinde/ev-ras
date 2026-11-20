
import { describe, expect, it } from 'vitest';
import type { VehicleState } from '../../vehicles/domain/vehicle';

import {
  createRoadNetwork,
  distanceMeters,
  getRoad,
  pointOnRoad,
  roadLengthMeters,
} from './road-network';

import {
  advanceSimulation,
  createSimulation,
} from './simulation';

const A = { latitude: 39.6837, longitude: -75.75 };
const B = { latitude: 39.6837, longitude: -75.749 };
const C = { latitude: 39.6847, longitude: -75.749 };

const D = { latitude: 39.685, longitude: -75.745 };
const E = { latitude: 39.686, longitude: -75.745 };

const network = createRoadNetwork([
  { id: 'EAST', points: [A, B] },
  { id: 'NORTH', points: [B, C] },
  { id: 'FAR', points: [D, E] },
]);

const ambulance: VehicleState = {
  id: 'AMB-001',
  kind: 'EMERGENCY',
  position: A,
  speedMps: 10,
  headingDeg: 90,
  timestampMs: 0,
};

const start = () =>
  createSimulation(network, 0, [
    {
      vehicle: ambulance,
      route: ['EAST', 'NORTH'],
    },
  ]);

describe('road network', () => {
  it('measures road distance in meters', () => {
    const length = roadLengthMeters(
      getRoad(network, 'EAST'),
    );

    expect(length).toBeGreaterThan(80);
    expect(length).toBeLessThan(90);
  });

  it('preserves intermediate bends in road geometry', () => {
    const bent = createRoadNetwork([
      {
        id: 'BENT',
        points: [
          A,
          { latitude: 39.684, longitude: -75.75 },
          B,
        ],
      },
    ]);

    const sampled = pointOnRoad(
      getRoad(bent, 'BENT'),
      15,
    );

    expect(sampled.position.longitude).toBeCloseTo(
      A.longitude,
      7,
    );

    expect(sampled.position.latitude).toBeGreaterThan(
      A.latitude,
    );
  });

  it('rejects duplicate and zero-length segments', () => {
    expect(() =>
      createRoadNetwork([
        { id: 'R', points: [A, B] },
        { id: 'R', points: [B, C] },
      ]),
    ).toThrow(/Duplicate/);

    expect(() =>
      createRoadNetwork([
        { id: 'R', points: [A, A] },
      ]),
    ).toThrow(/zero length/);
  });

  it('rejects invalid road coordinates', () => {
    expect(() =>
      createRoadNetwork([
        {
          id: 'R',
          points: [
            A,
            { latitude: Infinity, longitude: 0 },
          ],
        },
      ]),
    ).toThrow(RangeError);
  });
});

describe('simulation setup', () => {
  it('starts on the first route segment', () => {
    const sim = start();

    expect(sim.timeMs).toBe(0);
    expect(sim.vehicles[0].segmentIndex).toBe(0);
    expect(sim.vehicles[0].vehicle.position).toEqual(A);
    expect(sim.vehicles[0].finished).toBe(false);
  });

  it('rejects unknown and disconnected roads', () => {
    expect(() =>
      createSimulation(network, 0, [
        {
          vehicle: ambulance,
          route: ['UNKNOWN'],
        },
      ]),
    ).toThrow(/Unknown/);

    expect(() =>
      createSimulation(network, 0, [
        {
          vehicle: ambulance,
          route: ['EAST', 'FAR'],
        },
      ]),
    ).toThrow(/Disconnected/);
  });

  it('rejects empty routes and incorrect start positions', () => {
    expect(() =>
      createSimulation(network, 0, [
        {
          vehicle: ambulance,
          route: [],
        },
      ]),
    ).toThrow(/needs a route/);

    expect(() =>
      createSimulation(network, 0, [
        {
          vehicle: { ...ambulance, position: C },
          route: ['EAST'],
        },
      ]),
    ).toThrow(/must start/);
  });

  it('rejects duplicate vehicles and mismatched timestamps', () => {
    const plan = {
      vehicle: ambulance,
      route: ['EAST'],
    };

    expect(() =>
      createSimulation(network, 0, [plan, plan]),
    ).toThrow(/Duplicate vehicle/);

    expect(() =>
      createSimulation(network, 1, [plan]),
    ).toThrow(/timestamp/);
  });
});

describe('advanceSimulation', () => {
  it('moves along the road at the correct speed', () => {
    const next = advanceSimulation(
      network,
      start(),
      2000,
    );

    const position = next.vehicles[0].vehicle.position;

    expect(distanceMeters(A, position)).toBeCloseTo(
      20,
      0,
    );

    expect(next.timeMs).toBe(2000);

    expect(
      next.vehicles[0].vehicle.timestampMs,
    ).toBe(2000);

    expect(
      next.vehicles[0].vehicle.headingDeg,
    ).toBeCloseTo(90, 0);
  });

  it('turns onto the next connected road', () => {
    const next = advanceSimulation(
      network,
      start(),
      12_000,
    );

    expect(next.vehicles[0].segmentIndex).toBe(1);

    expect(
      next.vehicles[0].vehicle.position.latitude,
    ).toBeGreaterThan(B.latitude);

    expect(
      next.vehicles[0].vehicle.position.longitude,
    ).toBeCloseTo(B.longitude, 8);

    expect(
      next.vehicles[0].vehicle.headingDeg,
    ).toBeCloseTo(0, 0);
  });

  it('stops at the final destination', () => {
    const complete = advanceSimulation(
      network,
      start(),
      60_000,
    );

    expect(complete.vehicles[0].finished).toBe(true);

    expect(
      complete.vehicles[0].vehicle.position,
    ).toEqual(C);

    expect(
      complete.vehicles[0].vehicle.speedMps,
    ).toBe(0);

    const later = advanceSimulation(
      network,
      complete,
      5000,
    );

    expect(
      later.vehicles[0].vehicle.position,
    ).toEqual(C);
  });

  it('keeps stopped vehicles stationary', () => {
    const stopped = createSimulation(network, 0, [
      {
        vehicle: {
          ...ambulance,
          speedMps: 0,
        },
        route: ['EAST'],
      },
    ]);

    const next = advanceSimulation(
      network,
      stopped,
      5000,
    );

    expect(
      next.vehicles[0].vehicle.position,
    ).toEqual(A);

    expect(
      next.vehicles[0].vehicle.timestampMs,
    ).toBe(5000);
  });

  it('does not mutate previous simulation state', () => {
    const original = start();

    const next = advanceSimulation(
      network,
      original,
      3000,
    );

    expect(original.timeMs).toBe(0);

    expect(
      original.vehicles[0].vehicle.position,
    ).toEqual(A);

    expect(next).not.toBe(original);
  });

  it('produces equivalent results across time steps', () => {
    const direct = advanceSimulation(
      network,
      start(),
      12_000,
    );

    const split = advanceSimulation(
      network,
      advanceSimulation(network, start(), 5000),
      7000,
    );

    expect(
      split.vehicles[0].vehicle.position.latitude,
    ).toBeCloseTo(
      direct.vehicles[0].vehicle.position.latitude,
      10,
    );

    expect(
      split.vehicles[0].vehicle.position.longitude,
    ).toBeCloseTo(
      direct.vehicles[0].vehicle.position.longitude,
      10,
    );

    expect(split.timeMs).toBe(direct.timeMs);
  });

  it('updates multiple vehicles independently', () => {
    const civilian: VehicleState = {
      ...ambulance,
      id: 'CAR-001',
      kind: 'CIVILIAN',
      position: B,
      speedMps: 0,
    };

    const sim = createSimulation(network, 0, [
      {
        vehicle: ambulance,
        route: ['EAST'],
      },
      {
        vehicle: civilian,
        route: ['NORTH'],
      },
    ]);

    const next = advanceSimulation(
      network,
      sim,
      3000,
    );

    expect(
      next.vehicles[0].vehicle.position.longitude,
    ).toBeGreaterThan(A.longitude);

    expect(
      next.vehicles[1].vehicle.position,
    ).toEqual(B);
  });

  it('rejects invalid time steps', () => {
    expect(() =>
      advanceSimulation(network, start(), -1),
    ).toThrow(RangeError);

    expect(() =>
      advanceSimulation(network, start(), Infinity),
    ).toThrow(RangeError);

    expect(() =>
      advanceSimulation(network, start(), NaN),
    ).toThrow(RangeError);
  });
});
