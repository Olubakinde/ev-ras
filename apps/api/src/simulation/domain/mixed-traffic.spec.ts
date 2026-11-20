import { describe, expect, it } from 'vitest';
import type { DrivingRoute } from '../../routing/osrm-client.js';
import type { GeoPosition } from '../../vehicles/domain/vehicle.js';
import {
  createRoadNetwork,
  distanceMeters,
} from './road-network.js';
import {
  advanceMixedTraffic,
  buildMixedTrafficScenario,
  TRAFFIC_CAR_COUNT,
  TRAFFIC_TEMPLATE_COUNT,
  reachableTrafficTopology,
} from './mixed-traffic.js';

function makeRoute(id: string, latitude: number, longitude: number): DrivingRoute {
  const points: GeoPosition[] = Array.from({ length: 12 }, (_, index) => ({
    latitude,
    longitude: longitude + index * 0.00025,
  }));
  const segments = points.slice(1).map((point, index) => ({
    id: `${id}:${index}`,
    points: [points[index], point],
  }));
  const distance = segments.reduce(
    (total, segment) => total + distanceMeters(segment.points[0], segment.points[1]),
    0,
  );
  return {
    distanceMeters: distance,
    durationSeconds: distance / 12,
    coordinates: points.map((point) => [point.longitude, point.latitude] as const),
    roadNetwork: createRoadNetwork(segments),
    segmentIds: segments.map((segment) => segment.id),
    snappedStart: points[0],
    snappedEnd: points[points.length - 1],
  };
}

const ambulance = makeRoute('AMB-001', 39.683, -75.755);
const templates = Array.from({ length: TRAFFIC_TEMPLATE_COUNT }, (_, i) =>
  makeRoute(`TRAFFIC-0${i + 1}`, 39.682 + i * 0.001, -75.755),
);

function makeScenario(seed = 2026) {
  return buildMixedTrafficScenario(ambulance, templates, seed);
}

describe('mixed traffic scenario', () => {
  it('creates exactly one ambulance and 25 civilians', () => {
    const scene = makeScenario();
    expect(scene.initialSimulation.vehicles).toHaveLength(26);
    expect(scene.initialSimulation.vehicles.filter((v) => v.vehicle.kind === 'EMERGENCY')).toHaveLength(1);
    expect(scene.initialSimulation.vehicles.filter((v) => v.vehicle.kind === 'CIVILIAN')).toHaveLength(TRAFFIC_CAR_COUNT);
  });

  it('assigns stable, unique CAR-001 through CAR-025 identifiers', () => {
    const ids = makeScenario().initialSimulation.vehicles.slice(1).map((v) => v.vehicle.id);
    expect(ids[0]).toBe('CAR-001');
    expect(ids[24]).toBe('CAR-025');
    expect(new Set(ids).size).toBe(25);
  });

  it('uses all five route templates', () => {
    expect(new Set(makeScenario().profiles.map((p) => p.templateIndex)).size).toBe(5);
  });

  it('spreads each route population across distinct starting positions', () => {
    const cars = makeScenario().initialSimulation.vehicles.slice(1);
    for (let template = 0; template < 5; template++) {
      const locations = cars.filter((_, index) => index % 5 === template)
        .map(({ vehicle }) => JSON.stringify(vehicle.position));
      expect(new Set(locations).size).toBe(5);
    }
  });

  it('assigns different simulated cruising speeds', () => {
    const speeds = makeScenario().profiles.map((p) => p.cruiseSpeedMps);
    expect(new Set(speeds).size).toBeGreaterThan(10);
    expect(speeds.every((speed) => speed >= 6 && speed <= 17)).toBe(true);
  });

  it('returns the same scenario for the same seed', () => {
    const a = makeScenario(42);
    const b = makeScenario(42);
    expect(a.initialSimulation).toEqual(b.initialSimulation);
    expect(a.profiles).toEqual(b.profiles);
    expect(a.routes).toEqual(b.routes);
  });

  it('changes the traffic distribution when the seed changes', () => {
    expect(makeScenario(42).profiles).not.toEqual(makeScenario(43).profiles);
  });

  it('retains exactly 26 route summaries for later map integration', () => {
    const scene = makeScenario();
    expect(scene.routes).toHaveLength(26);
    expect(scene.routes[0].vehicleId).toBe('AMB-001');
    expect(scene.routes.at(-1)?.vehicleId).toBe('CAR-025');
    expect(scene.routes.every((route) => route.coordinates.length >= 2)).toBe(true);
  });

  it('does not invent road topology for truncated civilian routes', () => {
    const scene = makeScenario();
    expect(scene.topologies).toHaveLength(26);
    expect(scene.topologies.every((topology) => topology.nodes.length === 0)).toBe(true);
  });

  it('keeps trustworthy original-route OSM identities after the car starting point', () => {
    const withNodes = templates.map((route, templateIndex) => ({
      ...route,
      topologyNodes: route.coordinates.slice(1, -1).map(([longitude, latitude], index) => ({
        id: String(10000 + templateIndex * 100 + index),
        position: { latitude, longitude },
      })),
    }));
    const ambulanceNodes = {
      ...ambulance,
      topologyNodes: ambulance.coordinates.slice(1, -1).map(([longitude, latitude], index) => ({
        id: String(20000 + index),
        position: { latitude, longitude },
      })),
    };
    const scene = buildMixedTrafficScenario(ambulanceNodes, withNodes);
    expect(scene.topologies).toHaveLength(26);
    expect(scene.topologies[0].nodes).toEqual(ambulanceNodes.topologyNodes);
    expect(scene.topologies.slice(1).some((route) => route.nodes.length > 0)).toBe(true);
    for (const [index, car] of scene.initialSimulation.vehicles.slice(1).entries()) {
      const templateIndex = scene.profiles[index].templateIndex;
      const available = scene.topologies[index + 1].nodes;
      const source = withNodes[templateIndex].topologyNodes;
      const positions = withNodes[templateIndex].coordinates;
      for (const node of available) {
        expect(source.some((original) => original.id === node.id)).toBe(true);
        const originalIndex = positions.findIndex(
          ([longitude, latitude]) =>
            Math.abs(longitude - node.position.longitude) < 1e-10 &&
            Math.abs(latitude - node.position.latitude) < 1e-10,
        );
        const startLongitude = car.vehicle.position.longitude;
        expect(originalIndex).toBeGreaterThanOrEqual(1);
        expect(node.position.longitude).toBeGreaterThanOrEqual(startLongitude - 1e-8);
      }
    }
  });

  it('rejects ambiguous or incompatible route-to-topology alignment', () => {
    const withNodes = {
      ...templates[0],
      topologyNodes: [
        { id: '101', position: { latitude: 39.682, longitude: -75.755 } },
      ],
    };
    expect(reachableTrafficTopology(withNodes, 3)).toEqual([]);
    expect(reachableTrafficTopology({
      ...withNodes,
      coordinates: [[-75.755, 39.682]],
    }, 0)).toEqual([]);
    expect(reachableTrafficTopology({
      ...withNodes,
      coordinates: [
        ...withNodes.coordinates.slice(0, 3),
        withNodes.coordinates[0],
        ...withNodes.coordinates.slice(4),
      ],
    }, 0)).toEqual([]);
  });

  it('does not mutate the original OSRM route pool', () => {
    const roadsBefore = templates.map((route) => [...route.roadNetwork.keys()]);
    const coordsBefore = templates.map((route) => [...route.coordinates]);
    makeScenario();
    expect(templates.map((route) => [...route.roadNetwork.keys()])).toEqual(roadsBefore);
    expect(templates.map((route) => [...route.coordinates])).toEqual(coordsBefore);
  });

  it('rejects an invalid seed and missing route templates', () => {
    expect(() => makeScenario(-1)).toThrow(RangeError);
    expect(() => makeScenario(1.2)).toThrow(RangeError);
    expect(() => makeScenario(Number.NaN)).toThrow(RangeError);
    expect(() => buildMixedTrafficScenario(ambulance, templates.slice(1))).toThrow(/five|5/i);
  });

  it('rejects duplicate road segment IDs across route templates', () => {
    expect(() => buildMixedTrafficScenario(ambulance, [templates[0], ...templates.slice(0, 4)]))
      .toThrow(/Duplicate road segment/);
  });

  it('rejects invalid route metadata', () => {
    expect(() => buildMixedTrafficScenario({ ...ambulance, distanceMeters: -1 }, templates))
      .toThrow(/metadata/);
  });
});

describe('mixed traffic movement', () => {
  it('advances all 26 vehicles on a single shared simulation clock', () => {
    const scene = makeScenario();
    const next = advanceMixedTraffic(scene.network, scene.initialSimulation, 1000, scene.profiles);
    expect(next.timeMs).toBe(1000);
    expect(next.vehicles).toHaveLength(26);
    expect(next.vehicles.every((vehicle) => vehicle.vehicle.timestampMs === 1000)).toBe(true);
  });

  it('keeps the ambulance moving while civilian traffic can slow or stop', () => {
    const scene = makeScenario();
    const next = advanceMixedTraffic(scene.network, scene.initialSimulation, 1000, scene.profiles);
    expect(next.vehicles[0].vehicle.position).not.toEqual(scene.initialSimulation.vehicles[0].vehicle.position);
    expect(next.vehicles.some((vehicle) => vehicle.vehicle.kind === 'CIVILIAN' && vehicle.vehicle.speedMps === 0)).toBe(true);
    expect(next.vehicles.some((vehicle) => vehicle.vehicle.kind === 'CIVILIAN' && vehicle.vehicle.speedMps > 10)).toBe(true);
  });

  it('matches five one-second steps to a single five-second step', () => {
    const scene = makeScenario();
    const bulk = advanceMixedTraffic(scene.network, scene.initialSimulation, 5000, scene.profiles);
    let split = scene.initialSimulation;
    for (let i = 0; i < 5; i++) {
      split = advanceMixedTraffic(scene.network, split, 1000, scene.profiles);
    }
    expect(split).toEqual(bulk);
  });

  it('does not mutate previous simulation state', () => {
    const scene = makeScenario();
    const before = structuredClone(scene.initialSimulation);
    advanceMixedTraffic(scene.network, scene.initialSimulation, 1000, scene.profiles);
    expect(scene.initialSimulation).toEqual(before);
  });

  it('rejects invalid time steps', () => {
    const scene = makeScenario();
    expect(() => advanceMixedTraffic(scene.network, scene.initialSimulation, -1, scene.profiles)).toThrow(RangeError);
    expect(() => advanceMixedTraffic(scene.network, scene.initialSimulation, Infinity, scene.profiles)).toThrow(RangeError);
    expect(() => advanceMixedTraffic(scene.network, scene.initialSimulation, 60_001, scene.profiles)).toThrow(RangeError);
  });

  it('preserves the state for a zero-length step', () => {
    const scene = makeScenario();
    expect(advanceMixedTraffic(scene.network, scene.initialSimulation, 0, scene.profiles))
      .toBe(scene.initialSimulation);
  });
});
