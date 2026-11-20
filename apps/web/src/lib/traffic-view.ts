import type {
  DriverAlert,
  OperatorSnapshot,
  ScenarioRoute,
  Vehicle,
} from './scene';

/** Operator UI state. This is a synthetic traffic demo, not live driver telemetry. */
export interface TrafficStatus {
  active: boolean;
  mode: 'MIXED' | null;
  seed: number | null;
  civilianCount: number;
  routeTemplateCount: number;
  encounterEvaluation: string | null;
}

export interface TrafficResponse extends TrafficStatus {
  source: 'DEMO' | 'OSRM';
  routes: ScenarioRoute[];
  topologyStatus?: string;
  snapshot: OperatorSnapshot;
}

export const TRAFFIC_DEMO_SEED = 2026;

export function civilians(snapshot: OperatorSnapshot | null): Vehicle[] {
  return (snapshot?.vehicles ?? [])
    .filter((vehicle) => vehicle.kind === 'CIVILIAN')
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getDriverAlert(
  snapshot: OperatorSnapshot | null,
  driverId: string,
): DriverAlert | null {
  return snapshot?.alerts.find((alert) => alert.civilianVehicleId === driverId) ?? null;
}

/** Keep the existing sidebar's detailed cards compact in 25-car mode. */
export function featuredVehicles(
  snapshot: OperatorSnapshot | null,
  selectedDriverId: string,
  trafficMode: boolean,
): Vehicle[] {
  const all = snapshot?.vehicles ?? [];
  if (!trafficMode) return all;
  return all.filter((vehicle) => vehicle.kind === 'EMERGENCY' || vehicle.id === selectedDriverId);
}

/** Show only the ambulance and monitored civilian routes in crowded traffic scenes. */
export function visibleTrafficRoutes(
  routes: readonly ScenarioRoute[],
  selectedDriverId: string,
  trafficMode: boolean,
): ScenarioRoute[] {
  if (!trafficMode) return [...routes];
  return routes.filter((route) => route.vehicleId === 'AMB-001' || route.vehicleId === selectedDriverId);
}

export function driverDisplayName(id: string): string {
  const match = /^CAR-(\d{3})$/.exec(id);
  return match ? `Driver ${Number(match[1]).toString().padStart(2, '0')}` : id;
}

export function trafficSummary(snapshot: OperatorSnapshot | null) {
  const cars = civilians(snapshot);
  const alertedIds = new Set((snapshot?.alerts ?? []).map((alert) => alert.civilianVehicleId));
  return {
    total: cars.length,
    moving: cars.filter((car) => !car.finished && car.speedMps > 0).length,
    stopped: cars.filter((car) => !car.finished && car.speedMps === 0).length,
    arrived: cars.filter((car) => car.finished).length,
    warned: cars.filter((car) => alertedIds.has(car.id)).length,
  };
}

/** Linear visual interpolation between authoritative 1-second simulation ticks. */
export function interpolateCoordinates(
  start: readonly [number, number],
  end: readonly [number, number],
  progress: number,
): [number, number] {
  const amount = Math.max(0, Math.min(1, progress));
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
  ];
}
