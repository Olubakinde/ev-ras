import type { RoadTopologyNode } from '../detection/domain/road-topology.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOsmNodeId(value: unknown): string | null {
  if (typeof value === 'string') {
    return /^[1-9]\d*$/.test(value) ? value : null;
  }

  // A JSON number outside JS's safe integer range has lost precision.
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  // Zero, null, negative or imprecise node identifiers are not OSM evidence.
  return null;
}

/**
 * Extract OSM identities only when the annotation sequence can be mapped
 * unambiguously onto the original, unsimplified route coordinates.
 *
 * OSRM documents that the node list excludes the first and last user-supplied
 * coordinates. Some conforming responses contain an identifier for every
 * geometry coordinate. We support both *only* when lengths agree exactly.
 *
 * We intentionally return undefined (unverified) for any other shape.
 * Never zip unmatched arrays together: an offset by even one vertex could
 * falsely identify a grade-separated crossing as an intersection.
 */
export function parseOsrmNodeAnnotations(
  rawCoordinates: unknown,
  rawLegs: unknown,
): readonly RoadTopologyNode[] | undefined {
  if (
    !Array.isArray(rawCoordinates) ||
    rawCoordinates.length < 2 ||
    !Array.isArray(rawLegs) ||
    rawLegs.length !== 1
  ) {
    return undefined;
  }

  const leg: unknown = rawLegs[0];
  if (!isRecord(leg)) {
    return undefined;
  }

  const annotation: unknown = leg.annotation;
  if (!isRecord(annotation) || !Array.isArray(annotation.nodes)) {
    return undefined;
  }

  const ids: unknown[] = annotation.nodes;
  if (ids.length === 0) {
    return undefined;
  }

  const offset =
    ids.length === rawCoordinates.length - 2
      ? 1
      : ids.length === rawCoordinates.length
        ? 0
        : null;

  if (offset === null) {
    return undefined;
  }

  const nodes: RoadTopologyNode[] = [];

  for (let index = 0; index < ids.length; index++) {
    const id = parseOsmNodeId(ids[index]);
    const pair: unknown = rawCoordinates[index + offset];

    if (!id || !Array.isArray(pair) || pair.length !== 2) {
      return undefined;
    }

    const [longitude, latitude]: unknown[] = pair;

    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return undefined;
    }

    nodes.push({ id, position: { latitude, longitude } });
  }

  return nodes;
}
