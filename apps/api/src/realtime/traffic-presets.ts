import type { GeoPosition } from '../vehicles/domain/vehicle.js';

/**
 * Newark, Delaware demonstration endpoints. OSRM snaps every coordinate to
 * an actual routable road. These are NOT live traffic observations.
 */
export interface TrafficRoutePreset {
  readonly id: string;
  readonly origin: GeoPosition;
  readonly destination: GeoPosition;
}

export const NEWARK_TRAFFIC_ROUTES: readonly TrafficRoutePreset[] = [
  {
    id: 'AMB-001',
    origin: { latitude: 39.6838, longitude: -75.7542 },
    destination: { latitude: 39.6841, longitude: -75.7487 },
  },
  {
    id: 'TRAFFIC-01',
    origin: { latitude: 39.6818, longitude: -75.7525 },
    destination: { latitude: 39.6854, longitude: -75.7525 },
  },
  {
    id: 'TRAFFIC-02',
    origin: { latitude: 39.686, longitude: -75.755 },
    destination: { latitude: 39.682, longitude: -75.7476 },
  },
  {
    id: 'TRAFFIC-03',
    origin: { latitude: 39.682, longitude: -75.754 },
    destination: { latitude: 39.6865, longitude: -75.749 },
  },
  {
    id: 'TRAFFIC-04',
    origin: { latitude: 39.6858, longitude: -75.7465 },
    destination: { latitude: 39.6809, longitude: -75.755 },
  },
  {
    id: 'TRAFFIC-05',
    origin: { latitude: 39.6798, longitude: -75.7475 },
    destination: { latitude: 39.6868, longitude: -75.754 },
  },
];
