import { describe, expect, it } from 'vitest';
import type { DrivingRoute } from '../../routing/osrm-client.js';
import { createRoadNetwork, distanceMeters } from './road-network.js';
import { buildMixedTrafficScenario } from './mixed-traffic.js';
import { selectAlertableEncounters } from '../../detection/domain/road-aware-encounters.js';
import { reconcileAlerts } from '../../alerts/domain/alert-manager.js';
import type { EncounterCandidate } from '../../detection/domain/encounter-detector.js';
import type { GeoPosition } from '../../vehicles/domain/vehicle.js';

const W = { latitude: 39.683, longitude: -75.751 };
const X = { latitude: 39.683, longitude: -75.75 };
const E = { latitude: 39.683, longitude: -75.749 };
const S = { latitude: 39.682, longitude: -75.75 };
const N = { latitude: 39.684, longitude: -75.75 };

function route(id: string, points: GeoPosition[], sharedId?: string): DrivingRoute {
  const roads = points.slice(1).map((point, i) => ({
    id: `${id}:${i}`,
    points: [points[i], point],
  }));
  const total = roads.reduce((sum, r) => sum + distanceMeters(r.points[0], r.points[1]), 0);
  return {
    distanceMeters: total,
    durationSeconds: total / 12,
    coordinates: points.map((p) => [p.longitude, p.latitude] as const),
    roadNetwork: createRoadNetwork(roads),
    segmentIds: roads.map((r) => r.id),
    snappedStart: points[0],
    snappedEnd: points.at(-1)!,
    topologyNodes: sharedId
      ? [{ id: sharedId, position: { ...points[1] } }]
      : [{ id: String(1000 + Number(id.split('-').at(-1) ?? 0)), position: { ...points[1] } }],
  };
}

function scenario() {
  const ambulance = route('AMB-001', [W, X, E], '102');
  const crossing = route('TRAFFIC-01', [S, X, N], '102');
  const otherTemplates = Array.from({ length: 4 }, (_, i) => {
    const latitude = 39.687 + i * 0.001;
    return route(`TRAFFIC-0${i + 2}`, [
      { latitude, longitude: -75.752 },
      { latitude, longitude: -75.75 },
      { latitude, longitude: -75.748 },
    ]);
  });
  return buildMixedTrafficScenario(ambulance, [crossing, ...otherTemplates], 2026);
}

function candidate(driver: string): EncounterCandidate {
  return {
    emergencyVehicleId: 'AMB-001',
    civilianVehicleId: driver,
    location: { ...X },
    reason: 'CROSSING',
    emergencyEtaSeconds: 5,
    civilianEtaSeconds: 5.2,
    etaDifferenceSeconds: 0.2,
  };
}

describe('25-car topology-aware alert selection', () => {
  it('preserves the same shared OSM node for a car that has not passed it', () => {
    const scene = scenario();
    expect(scene.topologies).toHaveLength(26);
    expect(scene.topologies[0].nodes).toEqual([{ id: '102', position: X }]);
    expect(scene.topologies[1].vehicleId).toBe('CAR-001');
    expect(scene.topologies[1].nodes).toEqual([{ id: '102', position: X }]);
  });

  it('does not issue warnings for other routes or for a car already past the node', () => {
    const scene = scenario();
    // CAR-001 uses TRAFFIC-01 and starts before the shared node.
    // CAR-002 is on another street. CAR-021 is on TRAFFIC-01 but starts
    // beyond the shared node: its route must not inherit past intersections.
    const candidates = [candidate('CAR-001'), candidate('CAR-002'), candidate('CAR-021')];
    const accepted = selectAlertableEncounters(candidates, 'OSRM', scene.topologies);
    expect(accepted.map((item) => item.civilianVehicleId)).toEqual(['CAR-001']);
    expect(scene.topologies[21].nodes).toEqual([]);
  });

  it('creates only supported driver alerts through the existing alert lifecycle', () => {
    const scene = scenario();
    const accepted = selectAlertableEncounters(
      [candidate('CAR-001'), candidate('CAR-002'), candidate('CAR-021')],
      'OSRM',
      scene.topologies,
    );
    const result = reconcileAlerts([], accepted, 1000);
    expect(result.active).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('CREATED');
    expect(result.events[0].alert.civilianVehicleId).toBe('CAR-001');
    const cleared = reconcileAlerts(result.active, [], 2000);
    expect(cleared.events).toHaveLength(1);
    expect(cleared.events[0].type).toBe('CLEARED');
  });
});
