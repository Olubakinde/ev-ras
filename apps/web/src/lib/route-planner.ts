import type { Position } from './scene';

export const ROUTE_POINT_KEYS = [
  'ambulanceOrigin',
  'ambulanceDestination',
  'driverOrigin',
  'driverDestination',
] as const;

export type RoutePointKey = (typeof ROUTE_POINT_KEYS)[number];
export type RouteDraft = Record<RoutePointKey, Position | null>;

export const EMPTY_ROUTE_DRAFT: RouteDraft = {
  ambulanceOrigin: null,
  ambulanceDestination: null,
  driverOrigin: null,
  driverDestination: null,
};

export const ROUTE_POINT_DETAILS: ReadonlyArray<{
  key: RoutePointKey;
  label: string;
  vehicle: 'AMB-001' | 'CAR-001';
  marker: string;
}> = [
  { key: 'ambulanceOrigin', label: 'Starting point', vehicle: 'AMB-001', marker: 'A' },
  { key: 'ambulanceDestination', label: 'Destination', vehicle: 'AMB-001', marker: 'B' },
  { key: 'driverOrigin', label: 'Starting point', vehicle: 'CAR-001', marker: 'C' },
  { key: 'driverDestination', label: 'Destination', vehicle: 'CAR-001', marker: 'D' },
];

function isValidPosition(position: Position): boolean {
  return (
    Number.isFinite(position.latitude) &&
    Number.isFinite(position.longitude) &&
    position.latitude >= -90 &&
    position.latitude <= 90 &&
    position.longitude >= -180 &&
    position.longitude <= 180
  );
}

export function chooseRoutePoint(
  current: RouteDraft,
  key: RoutePointKey,
  position: Position,
): RouteDraft {
  if (!isValidPosition(position)) {
    throw new RangeError('Select a valid location on the map');
  }

  return { ...current, [key]: { ...position } };
}

export function nextUnselectedPoint(draft: RouteDraft): RoutePointKey | null {
  return ROUTE_POINT_KEYS.find((key) => draft[key] === null) ?? null;
}

export function selectedPointCount(draft: RouteDraft): number {
  return ROUTE_POINT_KEYS.filter((key) => draft[key] !== null).length;
}

function approxDistanceMeters(a: Position, b: Position): number {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function draftValidationMessage(draft: RouteDraft): string | null {
  if (nextUnselectedPoint(draft) !== null) {
    return 'Choose all four points on the map';
  }

  const { ambulanceOrigin, ambulanceDestination, driverOrigin, driverDestination } = draft;
  if (!ambulanceOrigin || !ambulanceDestination || !driverOrigin || !driverDestination) {
    return 'Choose all four points on the map';
  }

  if (
    !isValidPosition(ambulanceOrigin) ||
    !isValidPosition(ambulanceDestination) ||
    !isValidPosition(driverOrigin) ||
    !isValidPosition(driverDestination)
  ) {
    return 'One of the selected locations is invalid';
  }

  if (approxDistanceMeters(ambulanceOrigin, ambulanceDestination) < 25) {
    return 'Ambulance start and destination must be at least 25 m apart';
  }
  if (approxDistanceMeters(driverOrigin, driverDestination) < 25) {
    return 'Driver start and destination must be at least 25 m apart';
  }
  return null;
}

/** Speeds are controlled demonstration assumptions, not live GPS measurements. */
export function toRouteScenarioRequest(draft: RouteDraft) {
  const problem = draftValidationMessage(draft);
  if (problem !== null) throw new Error(problem);

  // The validator above proves that all four entries exist.
  const ambulanceOrigin = draft.ambulanceOrigin!;
  const ambulanceDestination = draft.ambulanceDestination!;
  const driverOrigin = draft.driverOrigin!;
  const driverDestination = draft.driverDestination!;

  return {
    vehicles: [
      {
        id: 'AMB-001' as const,
        origin: { ...ambulanceOrigin },
        destination: { ...ambulanceDestination },
        speedMps: 15,
      },
      {
        id: 'CAR-001' as const,
        origin: { ...driverOrigin },
        destination: { ...driverDestination },
        speedMps: 12,
      },
    ],
  };
}

export function formatPoint(position: Position | null): string {
  if (!position) return 'Choose on map';
  return `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}
