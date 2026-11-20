import { describe, expect, it } from 'vitest';
import {
  civilians,
  driverDisplayName,
  featuredVehicles,
  getDriverAlert,
  interpolateCoordinates,
  trafficSummary,
  visibleTrafficRoutes,
} from './traffic-view';
import type { OperatorSnapshot, ScenarioRoute, Vehicle } from './scene';

const car = (id: string, speedMps = 10, finished = false): Vehicle => ({
  id,
  kind: 'CIVILIAN',
  position: { latitude: 39.683, longitude: -75.75 },
  speedMps,
  headingDeg: 90,
  timestampMs: 0,
  finished,
});
const ambulance: Vehicle = { ...car('AMB-001'), kind: 'EMERGENCY' };
const snapshot: OperatorSnapshot = {
  timeMs: 1000,
  vehicles: [car('CAR-025', 0), ambulance, car('CAR-001'), car('CAR-002', 0, true)],
  alerts: [{
    id: 'alert-25',
    emergencyVehicleId: 'AMB-001',
    civilianVehicleId: 'CAR-025',
    location: ambulance.position,
    reason: 'CROSSING',
    classification: 'UNVERIFIED_ROUTE_ENCOUNTER',
    emergencyEtaSeconds: 5,
    civilianEtaSeconds: 3,
    etaDifferenceSeconds: 2,
    firstDetectedAtMs: 0,
    lastUpdatedAtMs: 1000,
  }],
};
const routes: ScenarioRoute[] = snapshot.vehicles.map((vehicle) => ({
  vehicleId: vehicle.id,
  distanceMeters: 100,
  durationSeconds: 10,
  coordinates: [[-75.75, 39.68], [-75.74, 39.68]],
}));

describe('10C traffic presentation', () => {
  it('sorts the civilian fleet by ID without ambulance', () => {
    expect(civilians(snapshot).map((v) => v.id)).toEqual(['CAR-001', 'CAR-002', 'CAR-025']);
  });
  it('does not mutate the operator snapshot', () => {
    civilians(snapshot);
    expect(snapshot.vehicles[0].id).toBe('CAR-025');
  });
  it('preserves every vehicle in normal route-planning mode', () => {
    expect(featuredVehicles(snapshot, 'CAR-025', false)).toEqual(snapshot.vehicles);
  });
  it('displays only ambulance and selected driver cards in traffic mode', () => {
    expect(featuredVehicles(snapshot, 'CAR-025', true).map((v) => v.id)).toEqual(['CAR-025', 'AMB-001']);
  });
  it('returns no phantom selected driver if the ID is not in the scene', () => {
    expect(featuredVehicles(snapshot, 'CAR-099', true).map((v) => v.id)).toEqual(['AMB-001']);
  });
  it('never exposes another driver\'s warning as the selected warning', () => {
    expect(getDriverAlert(snapshot, 'CAR-001')).toBeNull();
    expect(getDriverAlert(snapshot, 'CAR-025')?.id).toBe('alert-25');
  });
  it('handles null snapshots without throwing', () => {
    expect(civilians(null)).toEqual([]);
    expect(getDriverAlert(null, 'CAR-001')).toBeNull();
    expect(trafficSummary(null).total).toBe(0);
  });
  it('retains all routes in single-driver mode', () => {
    expect(visibleTrafficRoutes(routes, 'CAR-025', false)).toHaveLength(4);
  });
  it('retains just the ambulance and selected route in traffic mode', () => {
    expect(visibleTrafficRoutes(routes, 'CAR-025', true).map((r) => r.vehicleId))
      .toEqual(['CAR-025', 'AMB-001']);
  });
  it('does not create a selected route for an absent ID', () => {
    expect(visibleTrafficRoutes(routes, 'CAR-099', true).map((r) => r.vehicleId))
      .toEqual(['AMB-001']);
  });
  it('counts stopped, moving, arrived and warned drivers without overlap in motion counts', () => {
    expect(trafficSummary(snapshot)).toEqual({ total: 3, moving: 1, stopped: 1, arrived: 1, warned: 1 });
  });
  it('interpolates marker positions without overshooting coordinates', () => {
    expect(interpolateCoordinates([0, 0], [4, 8], 0.5)).toEqual([2, 4]);
    expect(interpolateCoordinates([0, 0], [4, 8], -3)).toEqual([0, 0]);
    expect(interpolateCoordinates([0, 0], [4, 8], 4)).toEqual([4, 8]);
  });
  it('formats known CAR IDs and leaves other IDs unchanged', () => {
    expect(driverDisplayName('CAR-025')).toBe('Driver 25');
    expect(driverDisplayName('CAR-001')).toBe('Driver 01');
    expect(driverDisplayName('AMB-001')).toBe('AMB-001');
  });
});
