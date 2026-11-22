import type { RoadTopologyNode } from '../detection/domain/road-topology.js';
import { parseOsrmNodeAnnotations } from './osrm-node-annotations.js';

/**
 * Accept annotations obtained by a second, independently parsed OSRM response
 * ONLY when it describes exactly the same unsimplified route geometry.
 *
 * The second response is evidence from the routing provider, not a geometric
 * guess about whether two streets connect. Different geometry, malformed
 * annotations, a missing route, or changed vertex ordering all fail closed.
 *
 * This can recover a transiently missing/partial annotation response; it
 * cannot reconstruct node IDs that OSRM never supplies.
 */
export function recoverMatchingNodeAnnotations(
  originalCoordinates: unknown,
  retryPayload: unknown,
): readonly RoadTopologyNode[] | undefined {
  if (
    !Array.isArray(originalCoordinates) ||
    originalCoordinates.length < 2 ||
    originalCoordinates.length > 50_000 ||
    !isRecord(retryPayload) ||
    retryPayload.code !== 'Ok' ||
    !Array.isArray(retryPayload.routes) ||
    retryPayload.routes.length < 1
  ) {
    return undefined;
  }

  const route: unknown = retryPayload.routes[0];
  if (
    !isRecord(route) ||
    !isRecord(route.geometry) ||
    route.geometry.type !== 'LineString' ||
    !Array.isArray(route.geometry.coordinates) ||
    route.geometry.coordinates.length !== originalCoordinates.length
  ) {
    return undefined;
  }

  const secondCoordinates: unknown[] = route.geometry.coordinates;
  for (let index = 0; index < originalCoordinates.length; index++) {
    const first: unknown = originalCoordinates[index];
    const second: unknown = secondCoordinates[index];
    if (
      !Array.isArray(first) || first.length !== 2 ||
      !Array.isArray(second) || second.length !== 2 ||
      typeof first[0] !== 'number' || typeof first[1] !== 'number' ||
      !Number.isFinite(first[0]) || !Number.isFinite(first[1]) ||
      first[0] !== second[0] || first[1] !== second[1]
    ) {
      return undefined;
    }
  }

  return parseOsrmNodeAnnotations(secondCoordinates, route.legs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
