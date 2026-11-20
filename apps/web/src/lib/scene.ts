export interface Position {
  latitude: number;
  longitude: number;
}

export interface Vehicle {
  id: string;
  kind: 'EMERGENCY' | 'CIVILIAN';
  position: Position;
  speedMps: number;
  headingDeg: number;
  timestampMs: number;
  finished?: boolean;
}

export interface DriverAlert {
  id: string;
  emergencyVehicleId: string;
  civilianVehicleId: string;
  location: Position;
  reason: string;
  classification: 'UNVERIFIED_ROUTE_ENCOUNTER';
  emergencyEtaSeconds: number;
  civilianEtaSeconds: number | null;
  etaDifferenceSeconds: number | null;
  firstDetectedAtMs: number;
  lastUpdatedAtMs: number;
}

export interface OperatorSnapshot {
  timeMs: number;
  vehicles: Vehicle[];
  alerts: DriverAlert[];
}

export interface ScenarioRoute {
  vehicleId: string;
  distanceMeters: number;
  durationSeconds: number;
  coordinates: [number, number][];
}

export interface RouteMetadata {
  source: 'DEMO' | 'OSRM';
  routes: ScenarioRoute[];
  topologyStatus?: string;
}

export interface ScenarioResponse extends RouteMetadata {
  snapshot: OperatorSnapshot;
}

export interface AdvanceResponse {
  timeMs: number;
  encounterCount: number;
  suppressedCandidateCount?: number;
  events: unknown[];
  snapshot: OperatorSnapshot;
}

export interface DriverSession {
  driverId: string;
  token: string;
  namespace: string;
}

export const NEWARK_SCENARIO = {
  vehicles: [
    {
      id: 'AMB-001',
      origin: { latitude: 39.6838, longitude: -75.7542 },
      destination: { latitude: 39.6841, longitude: -75.7487 },
      speedMps: 15,
    },
    {
      id: 'CAR-001',
      origin: { latitude: 39.6818, longitude: -75.7525 },
      destination: { latitude: 39.6854, longitude: -75.7525 },
      speedMps: 12,
    },
  ],
};

/** Visual-only mock road geometry for the initial DEMO scene. */
export const DEMO_ROUTES: ScenarioRoute[] = [
  {
    vehicleId: 'AMB-001',
    distanceMeters: 0,
    durationSeconds: 0,
    coordinates: [[-75.751, 39.683], [-75.75, 39.683], [-75.749, 39.683]],
  },
  {
    vehicleId: 'CAR-001',
    distanceMeters: 0,
    durationSeconds: 0,
    coordinates: [[-75.75, 39.682], [-75.75, 39.683], [-75.75, 39.684]],
  },
  {
    vehicleId: 'CAR-002',
    distanceMeters: 0,
    durationSeconds: 0,
    coordinates: [[-75.751, 39.6833], [-75.749, 39.6833]],
  },
];

export function displayRoutes(meta: RouteMetadata): ScenarioRoute[] {
  return meta.source === 'OSRM' && meta.routes.length ? meta.routes : DEMO_ROUTES;
}

export function formatSimTime(timeMs: number): string {
  const seconds = Math.max(0, Math.floor(timeMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return '—';
  return distanceMeters < 1000
    ? `${Math.round(distanceMeters)} m`
    : `${(distanceMeters / 1000).toFixed(2)} km`;
}

export function vehicleLabel(id: string): string {
  if (id.startsWith('AMB')) return 'Emergency vehicle';
  if (id === 'CAR-001') return 'Driver 01';
  if (id === 'CAR-002') return 'Driver 02';
  return id;
}

export function alertTitle(reason: string): string {
  switch (reason) {
    case 'CROSSING': return 'Potential crossing ahead';
    case 'SHARED_PATH': return 'Shared route ahead';
    case 'NEAR_PATH': return 'Nearby emergency route';
    case 'STATIONARY_ON_PATH': return 'Vehicle on emergency route';
    default: return 'Potential route encounter';
  }
}

export function getPrimaryDriverAlert(snapshot: OperatorSnapshot | null): DriverAlert | null {
  return snapshot?.alerts.find((alert) => alert.civilianVehicleId === 'CAR-001') ?? null;
}
