
import type { GeoPosition } from '../../vehicles/domain/vehicle.js';

export interface RoadSegment {
  readonly id: string;
  readonly points: readonly GeoPosition[];
}

export type RoadNetwork = ReadonlyMap<string, RoadSegment>;

const EARTH_RADIUS_M = 6_371_008.8;

const radians = (degrees: number): number =>
  (degrees * Math.PI) / 180;

/**
 * Returns the great-circle distance between two coordinates.
 */
export function distanceMeters(
  a: GeoPosition,
  b: GeoPosition,
): number {
  const latDelta = radians(b.latitude - a.latitude);
  const lonDelta = radians(b.longitude - a.longitude);

  const h =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(lonDelta / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_M *
    Math.asin(Math.sqrt(Math.min(1, h)))
  );
}

/**
 * Compass bearing measured clockwise from north.
 */
function headingDegrees(
  a: GeoPosition,
  b: GeoPosition,
): number {
  const lonDelta = radians(b.longitude - a.longitude);

  const y =
    Math.sin(lonDelta) * Math.cos(radians(b.latitude));

  const x =
    Math.cos(radians(a.latitude)) *
      Math.sin(radians(b.latitude)) -
    Math.sin(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.cos(lonDelta);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Calculates the full length of a road polyline.
 */
export function roadLengthMeters(
  road: RoadSegment,
): number {
  let total = 0;

  for (let i = 1; i < road.points.length; i++) {
    total += distanceMeters(
      road.points[i - 1],
      road.points[i],
    );
  }

  return total;
}

/**
 * Creates and validates a directed road network.
 */
export function createRoadNetwork(
  roads: readonly RoadSegment[],
): RoadNetwork {
  if (roads.length === 0) {
    throw new Error('Road network cannot be empty');
  }

  const network = new Map<string, RoadSegment>();

  for (const road of roads) {
    if (
      typeof road.id !== 'string' ||
      !road.id.trim()
    ) {
      throw new Error('Road segment ID cannot be empty');
    }

    if (network.has(road.id)) {
      throw new Error(`Duplicate road segment: ${road.id}`);
    }

    if (
      !Array.isArray(road.points) ||
      road.points.length < 2
    ) {
      throw new Error(
        `Road segment ${road.id} needs at least two points`,
      );
    }

    for (const point of road.points) {
      if (
        !point ||
        !Number.isFinite(point.latitude) ||
        point.latitude < -90 ||
        point.latitude > 90 ||
        !Number.isFinite(point.longitude) ||
        point.longitude < -180 ||
        point.longitude > 180
      ) {
        throw new RangeError(
          `Invalid coordinates in road segment ${road.id}`,
        );
      }
    }

    // Copy input coordinates to protect against later mutations.
    const safeRoad: RoadSegment = {
      id: road.id,
      points: road.points.map((point) => ({ ...point })),
    };

    if (roadLengthMeters(safeRoad) <= 0) {
      throw new Error(
        `Road segment ${road.id} has zero length`,
      );
    }

    network.set(safeRoad.id, safeRoad);
  }

  return network;
}

/**
 * Retrieves a road by ID.
 */
export function getRoad(
  network: RoadNetwork,
  id: string,
): RoadSegment {
  const road = network.get(id);

  if (!road) {
    throw new Error(`Unknown road segment: ${id}`);
  }

  return road;
}

/**
 * Returns a geographic position and heading at a specified
 * distance along a directed road polyline.
 *
 * Linear coordinate interpolation is suitable for our
 * short, local road segments in this simulation.
 */
export function pointOnRoad(
  road: RoadSegment,
  distanceM: number,
): {
  position: GeoPosition;
  headingDeg: number;
} {
  if (
    !Number.isFinite(distanceM) ||
    distanceM < 0
  ) {
    throw new RangeError(
      'Distance along road must be finite and nonnegative',
    );
  }

  const target = Math.min(
    distanceM,
    roadLengthMeters(road),
  );

  let covered = 0;

  for (let i = 1; i < road.points.length; i++) {
    const from = road.points[i - 1];
    const to = road.points[i];

    const length = distanceMeters(from, to);

    if (length === 0) {
      continue;
    }

    if (target <= covered + length) {
      const fraction = Math.max(
        0,
        Math.min(1, (target - covered) / length),
      );

      return {
        position: {
          latitude:
            from.latitude +
            (to.latitude - from.latitude) * fraction,
          longitude:
            from.longitude +
            (to.longitude - from.longitude) * fraction,
        },
        headingDeg: headingDegrees(from, to),
      };
    }

    covered += length;
  }

  // Floating-point fallback at the end of the road.
  const last = road.points[road.points.length - 1];

  for (let i = road.points.length - 2; i >= 0; i--) {
    if (distanceMeters(road.points[i], last) > 0) {
      return {
        position: { ...last },
        headingDeg: headingDegrees(
          road.points[i],
          last,
        ),
      };
    }
  }

  throw new Error(
    `Road segment ${road.id} has no traversable geometry`,
  );
}
