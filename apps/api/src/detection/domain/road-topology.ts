
import type {
    GeoPosition,
  } from '../../vehicles/domain/vehicle.js';

  import {
    distanceMeters,
  } from '../../simulation/domain/road-network.js';

  import type {
    EncounterCandidate,
  } from './encounter-detector.js';

  /**
   * OSM node IDs must remain strings.
   *
   * A node ID represents a road-network vertex,
   * not simply a coordinate on a map.
   */
  export interface RoadTopologyNode {
    readonly id: string;
    readonly position: GeoPosition;
  }

  export interface VehicleRoadTopology {
    readonly vehicleId: string;
    readonly nodes: readonly RoadTopologyNode[];
  }

  export type RoadEvidenceKind =
    | 'SHARED_NODE'
    | 'SHARED_EDGE';

  export interface RoadConflictEvidence {
    readonly kind: RoadEvidenceKind;
    readonly location: GeoPosition;
    readonly edge?: readonly [
      GeoPosition,
      GeoPosition,
    ];
  }

  export type RoadConflictAssessment =
    | {
        readonly status: 'SUPPORTED';
        readonly evidenceKind: RoadEvidenceKind;
      }
    | {
        readonly status: 'UNVERIFIED';
      };

  const DEFAULT_TOLERANCE_M = 2;
  const METERS_PER_DEGREE = 111_195;

  function validateTolerance(
    value: number,
  ): void {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 20
    ) {
      throw new RangeError(
        'Topology tolerance must be between 0 and 20 meters',
      );
    }
  }

  function validatePosition(
    position: GeoPosition,
  ): void {
    if (
      !position ||
      !Number.isFinite(position.latitude) ||
      !Number.isFinite(position.longitude) ||
      position.latitude < -90 ||
      position.latitude > 90 ||
      position.longitude < -180 ||
      position.longitude > 180
    ) {
      throw new RangeError(
        'Invalid topology coordinates',
      );
    }
  }

  function validateTopology(
    route: VehicleRoadTopology,
  ): void {
    if (
      typeof route.vehicleId !== 'string' ||
      !route.vehicleId.trim()
    ) {
      throw new Error(
        'Topology vehicle ID cannot be empty',
      );
    }

    if (!Array.isArray(route.nodes)) {
      throw new Error(
        'Topology nodes must be an array',
      );
    }

    for (const node of route.nodes) {
      if (
        !node ||
        typeof node.id !== 'string' ||
        !/^[1-9]\d*$/.test(node.id)
      ) {
        throw new Error(
          'OSM node IDs must be positive integer strings',
        );
      }

      validatePosition(node.position);
    }
  }

  function midpoint(
    a: GeoPosition,
    b: GeoPosition,
  ): GeoPosition {
    return {
      latitude: (a.latitude + b.latitude) / 2,
      longitude: (a.longitude + b.longitude) / 2,
    };
  }

  /**
   * Approximate point-to-segment distance in meters.
   *
   * Intended for short, local road segments.
   * Not a general-purpose global geodesic algorithm.
   */
  function pointToSegmentMeters(
    point: GeoPosition,
    start: GeoPosition,
    end: GeoPosition,
  ): number {
    const longitudeScale =
      METERS_PER_DEGREE *
      Math.cos((point.latitude * Math.PI) / 180);

    const ax =
      (start.longitude - point.longitude) *
      longitudeScale;

    const ay =
      (start.latitude - point.latitude) *
      METERS_PER_DEGREE;

    const bx =
      (end.longitude - point.longitude) *
      longitudeScale;

    const by =
      (end.latitude - point.latitude) *
      METERS_PER_DEGREE;

    const dx = bx - ax;
    const dy = by - ay;

    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return distanceMeters(point, start);
    }

    const fraction = Math.max(
      0,
      Math.min(
        1,
        -(ax * dx + ay * dy) / lengthSquared,
      ),
    );

    const nearestX = ax + fraction * dx;
    const nearestY = ay + fraction * dy;

    return Math.hypot(nearestX, nearestY);
  }

  /**
   * Match road-network evidence using OSM node
   * identities and compatible coordinates.
   *
   * Geometric proximity alone never creates
   * connectivity evidence.
   *
   * Shared nodes indicate a common graph vertex.
   * Shared edges indicate consecutive common nodes.
   */
  export function findSharedRoadEvidence(
    emergency: VehicleRoadTopology,
    civilian: VehicleRoadTopology,
    toleranceMeters = DEFAULT_TOLERANCE_M,
  ): readonly RoadConflictEvidence[] {
    validateTolerance(toleranceMeters);
    validateTopology(emergency);
    validateTopology(civilian);

    if (
      emergency.vehicleId === civilian.vehicleId
    ) {
      throw new Error(
        'Road evidence requires two different vehicles',
      );
    }

    const evidence: RoadConflictEvidence[] = [];

    const civilianByNodeId = new Map<
      string,
      RoadTopologyNode[]
    >();

    for (const node of civilian.nodes) {
      const matches =
        civilianByNodeId.get(node.id) ?? [];

      matches.push(node);
      civilianByNodeId.set(node.id, matches);
    }

    // An identical OSM node ID, with compatible
    // coordinates, is evidence of a shared vertex.
    for (const emergencyNode of emergency.nodes) {
      const matches =
        civilianByNodeId.get(emergencyNode.id) ?? [];

      for (const civilianNode of matches) {
        if (
          distanceMeters(
            emergencyNode.position,
            civilianNode.position,
          ) <= toleranceMeters
        ) {
          evidence.push({
            kind: 'SHARED_NODE',
            location: {
              ...emergencyNode.position,
            },
          });
        }
      }
    }

    // Two matching consecutive OSM nodes establish
    // a shared edge, including reverse travel.
    for (
      let i = 1;
      i < emergency.nodes.length;
      i++
    ) {
      const a = emergency.nodes[i - 1];
      const b = emergency.nodes[i];

      if (a.id === b.id) {
        continue;
      }

      for (
        let j = 1;
        j < civilian.nodes.length;
        j++
      ) {
        const c = civilian.nodes[j - 1];
        const d = civilian.nodes[j];

        const forward =
          a.id === c.id &&
          b.id === d.id &&
          distanceMeters(
            a.position,
            c.position,
          ) <= toleranceMeters &&
          distanceMeters(
            b.position,
            d.position,
          ) <= toleranceMeters;

        const reverse =
          a.id === d.id &&
          b.id === c.id &&
          distanceMeters(
            a.position,
            d.position,
          ) <= toleranceMeters &&
          distanceMeters(
            b.position,
            c.position,
          ) <= toleranceMeters;

        if (forward || reverse) {
          evidence.push({
            kind: 'SHARED_EDGE',
            location: midpoint(
              a.position,
              b.position,
            ),
            edge: [
              { ...a.position },
              { ...b.position },
            ],
          });
        }
      }
    }

    return evidence;
  }

  /**
   * Verify whether a geometric encounter candidate
   * occurs at an evidenced road conflict.
   *
   * A shared node elsewhere on the route does not
   * verify an unrelated crossing.
   */
  export function assessRoadConflict(
    candidate: EncounterCandidate,
    emergency: VehicleRoadTopology,
    civilian: VehicleRoadTopology,
    toleranceMeters = DEFAULT_TOLERANCE_M,
  ): RoadConflictAssessment {
    if (
      candidate.emergencyVehicleId !==
        emergency.vehicleId ||
      candidate.civilianVehicleId !==
        civilian.vehicleId
    ) {
      throw new Error(
        'Encounter and topology vehicle IDs do not match',
      );
    }

    validatePosition(candidate.location);

    const evidence = findSharedRoadEvidence(
      emergency,
      civilian,
      toleranceMeters,
    );

    // Edge evidence supports points between two
    // shared nodes, not only at their endpoints.
    for (const item of evidence) {
      if (
        item.kind === 'SHARED_EDGE' &&
        item.edge &&
        pointToSegmentMeters(
          candidate.location,
          item.edge[0],
          item.edge[1],
        ) <= toleranceMeters
      ) {
        return {
          status: 'SUPPORTED',
          evidenceKind: 'SHARED_EDGE',
        };
      }
    }

    for (const item of evidence) {
      if (
        item.kind === 'SHARED_NODE' &&
        distanceMeters(
          candidate.location,
          item.location,
        ) <= toleranceMeters
      ) {
        return {
          status: 'SUPPORTED',
          evidenceKind: 'SHARED_NODE',
        };
      }
    }

    return { status: 'UNVERIFIED' };
  }

  /**
   * Fail-closed post-filter for encounter candidates.
   *
   * Only encounters supported by supplied topology
   * are returned. Missing evidence is never invented.
   *
   * Note: this filters an existing candidate set.
   * A future integration will apply topology checks
   * during candidate selection itself.
   */
  export function filterTopologicallySupportedEncounters(
    candidates: readonly EncounterCandidate[],
    topologies: readonly VehicleRoadTopology[],
    toleranceMeters = DEFAULT_TOLERANCE_M,
  ): EncounterCandidate[] {
    validateTolerance(toleranceMeters);

    const byVehicleId =
      new Map<string, VehicleRoadTopology>();

    for (const topology of topologies) {
      validateTopology(topology);

      if (byVehicleId.has(topology.vehicleId)) {
        throw new Error(
          `Duplicate vehicle topology: ${topology.vehicleId}`,
        );
      }

      byVehicleId.set(
        topology.vehicleId,
        topology,
      );
    }

    return candidates.filter((candidate) => {
      const emergency = byVehicleId.get(
        candidate.emergencyVehicleId,
      );

      const civilian = byVehicleId.get(
        candidate.civilianVehicleId,
      );

      if (!emergency || !civilian) {
        return false;
      }

      return (
        assessRoadConflict(
          candidate,
          emergency,
          civilian,
          toleranceMeters,
        ).status === 'SUPPORTED'
      );
    });
  }
