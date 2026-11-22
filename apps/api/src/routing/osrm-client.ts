import type { RoadTopologyNode } from '../detection/domain/road-topology.js';
import type { GeoPosition } from '../vehicles/domain/vehicle.js';
import {
  createRoadNetwork,
  distanceMeters,
  type RoadNetwork,
  type RoadSegment,
} from '../simulation/domain/road-network.js';

import { parseOsrmNodeAnnotations } from './osrm-node-annotations.js';
import { recoverMatchingNodeAnnotations } from './topology-recovery.js';

export interface DrivingRoute {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly coordinates: readonly (readonly [number, number])[];
  readonly roadNetwork: RoadNetwork;
  readonly segmentIds: readonly string[];
  readonly snappedStart: GeoPosition;
  readonly snappedEnd: GeoPosition;
  /** Undefined means OSRM did not supply unambiguously aligned node evidence. */
  readonly topologyNodes?: readonly RoadTopologyNode[];
}

const MIN_SEGMENT_LENGTH_M = 0.05;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePosition(position: GeoPosition): void {
  if (
    !position ||
    !Number.isFinite(position.latitude) ||
    position.latitude < -90 ||
    position.latitude > 90 ||
    !Number.isFinite(position.longitude) ||
    position.longitude < -180 ||
    position.longitude > 180
  ) {
    throw new RangeError('Invalid geographic position');
  }
}

function parseCoordinates(raw: unknown): GeoPosition[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error('OSRM returned invalid route geometry');
  }

  const points: GeoPosition[] = [];

  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error('Invalid OSRM coordinate pair');
    }

    const [longitude, latitude] = pair;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new Error('Invalid OSRM coordinate values');
    }

    const position = { latitude, longitude };
    validatePosition(position);

    // The simulation already strips near-duplicate route vertices.
    const previous = points[points.length - 1];
    if (
      !previous ||
      distanceMeters(previous, position) >= MIN_SEGMENT_LENGTH_M
    ) {
      points.push(position);
    }
  }

  if (points.length < 2) {
    throw new Error('OSRM route has no traversable geometry');
  }

  return points;
}

export class OsrmClient {
  constructor(
    private readonly request: typeof fetch = globalThis.fetch,
    private readonly baseUrl: string =
      process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org',
    private readonly retryMissingTopology = false,
  ) {}

  async getDrivingRoute(
    origin: GeoPosition,
    destination: GeoPosition,
    routeId = 'route',
  ): Promise<DrivingRoute> {
    validatePosition(origin);
    validatePosition(destination);

    if (!routeId.trim()) {
      throw new Error('Route ID cannot be empty');
    }

    const start = `${origin.longitude},${origin.latitude}`;
    const end = `${destination.longitude},${destination.latitude}`;

    const url = new URL(`/route/v1/driving/${start};${end}`, this.baseUrl);
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'false');
    url.searchParams.set('annotations', 'nodes');

    const response = await this.request(url.toString(), {
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`OSRM request failed with HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      payload.code !== 'Ok' ||
      !Array.isArray(payload.routes) ||
      payload.routes.length === 0
    ) {
      throw new Error('OSRM could not calculate a route');
    }

    const route: unknown = payload.routes[0];
    if (
      !isRecord(route) ||
      !Number.isFinite(route.distance) ||
      !Number.isFinite(route.duration) ||
      typeof route.distance !== 'number' ||
      typeof route.duration !== 'number' ||
      route.distance < 0 ||
      route.duration < 0 ||
      !isRecord(route.geometry) ||
      route.geometry.type !== 'LineString'
    ) {
      throw new Error('OSRM returned invalid route data');
    }

    // Node IDs are mapped against the RAW route geometry, never the
    // deduplicated simulation geometry. If deduplication changes the count,
    // discard the node evidence rather than risk mismatched indexes.
    const rawCoordinates: unknown = route.geometry.coordinates;
    const originalTopology = parseOsrmNodeAnnotations(
      rawCoordinates,
      route.legs,
    );
    const points = parseCoordinates(rawCoordinates);
    let topologyNodes =
      Array.isArray(rawCoordinates) && rawCoordinates.length === points.length
        ? originalTopology
        : undefined;

    // Best-effort recovery from the routing provider itself. Never derive
    // intersection identity from coordinate proximity. Retry only when
    // the original raw route can be mapped 1:1 to simulation vertices.
    if (
      this.retryMissingTopology &&
      topologyNodes === undefined &&
      Array.isArray(rawCoordinates) &&
      rawCoordinates.length === points.length
    ) {
      const retryUrl = new URL(url.toString());
      retryUrl.searchParams.set('steps', 'true');
      try {
        const retryResponse = await this.request(retryUrl.toString(), {
          signal: AbortSignal.timeout(8_000),
        });
        if (retryResponse.ok) {
          const retryPayload: unknown = await retryResponse.json();
          topologyNodes = recoverMatchingNodeAnnotations(
            rawCoordinates,
            retryPayload,
          );
        }
      } catch {
        // Keep the first valid driving route, but withhold OSM evidence.
        // A failed retry must never turn a valid route into an alert.
      }
    }

    const segments: RoadSegment[] = [];
    for (let i = 1; i < points.length; i++) {
      segments.push({
        id: `${routeId}:${i - 1}`,
        points: [points[i - 1], points[i]],
      });
    }

    const roadNetwork = createRoadNetwork(segments);
    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      coordinates: points.map(
        (point) => [point.longitude, point.latitude] as const,
      ),
      roadNetwork,
      segmentIds: segments.map((segment) => segment.id),
      snappedStart: { ...points[0] },
      snappedEnd: { ...points[points.length - 1] },
      ...(topologyNodes ? { topologyNodes } : {}),
    };
  }
}
