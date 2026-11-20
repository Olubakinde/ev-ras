
import {
    describe,
    expect,
    it,
  } from 'vitest';

  import type {
    EncounterCandidate,
  } from './encounter-detector.js';

  import {
    assessRoadConflict,
    filterTopologicallySupportedEncounters,
    findSharedRoadEvidence,
    type RoadTopologyNode,
    type VehicleRoadTopology,
  } from './road-topology.js';

  const A = {
    latitude: 39.683,
    longitude: -75.751,
  };

  const B = {
    latitude: 39.683,
    longitude: -75.75,
  };

  const C = {
    latitude: 39.683,
    longitude: -75.749,
  };

  const SOUTH = {
    latitude: 39.682,
    longitude: -75.75,
  };

  const NORTH = {
    latitude: 39.684,
    longitude: -75.75,
  };

  function node(
    id: string,
    position: RoadTopologyNode['position'],
  ): RoadTopologyNode {
    return {
      id,
      position: { ...position },
    };
  }

  const emergency: VehicleRoadTopology = {
    vehicleId: 'AMB-001',
    nodes: [
      node('101', A),
      node('102', B),
      node('103', C),
    ],
  };

  const crossingDriver: VehicleRoadTopology = {
    vehicleId: 'CAR-001',
    nodes: [
      node('201', SOUTH),
      node('102', B),
      node('203', NORTH),
    ],
  };

  const crossing: EncounterCandidate = {
    emergencyVehicleId: 'AMB-001',
    civilianVehicleId: 'CAR-001',
    location: { ...B },
    reason: 'CROSSING',
    emergencyEtaSeconds: 5,
    civilianEtaSeconds: 5.2,
    etaDifferenceSeconds: 0.2,
  };

  describe('findSharedRoadEvidence', () => {
    it('recognizes a shared OSM intersection node', () => {
      const evidence = findSharedRoadEvidence(
        emergency,
        crossingDriver,
      );

      expect(evidence).toContainEqual({
        kind: 'SHARED_NODE',
        location: B,
      });
    });

    it('does not equate identical coordinates with shared nodes', () => {
      const gradeSeparated: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [
          node('201', SOUTH),
          node('999', B),
          node('203', NORTH),
        ],
      };

      expect(
        findSharedRoadEvidence(
          emergency,
          gradeSeparated,
        ),
      ).toEqual([]);
    });

    it('ignores matching IDs with inconsistent coordinates', () => {
      const inconsistent: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [
          node('102', NORTH),
        ],
      };

      expect(
        findSharedRoadEvidence(
          emergency,
          inconsistent,
        ),
      ).toEqual([]);
    });

    it('recognizes a shared road edge', () => {
      const driver: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [
          node('102', B),
          node('103', C),
        ],
      };

      const evidence = findSharedRoadEvidence(
        emergency,
        driver,
      );

      expect(
        evidence.some(
          (item) => item.kind === 'SHARED_EDGE',
        ),
      ).toBe(true);
    });

    it('recognizes a shared edge in reverse direction', () => {
      const driver: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [
          node('103', C),
          node('102', B),
        ],
      };

      const evidence = findSharedRoadEvidence(
        emergency,
        driver,
      );

      expect(
        evidence.some(
          (item) => item.kind === 'SHARED_EDGE',
        ),
      ).toBe(true);
    });

    it('does not infer an edge from two nonconsecutive shared nodes', () => {
      const driver: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [
          node('102', B),
          node('555', {
            latitude: 39.6835,
            longitude: -75.7495,
          }),
          node('103', C),
        ],
      };

      const evidence = findSharedRoadEvidence(
        emergency,
        driver,
      );

      expect(
        evidence.some(
          (item) => item.kind === 'SHARED_EDGE',
        ),
      ).toBe(false);
    });

    it('returns no evidence for unavailable road nodes', () => {
      const unknown: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [],
      };

      expect(
        findSharedRoadEvidence(
          emergency,
          unknown,
        ),
      ).toEqual([]);
    });

    it('preserves large OSM IDs as strings', () => {
      const id = '9007199254740993';

      const first: VehicleRoadTopology = {
        vehicleId: 'AMB-001',
        nodes: [node(id, B)],
      };

      const second: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [node(id, B)],
      };

      expect(
        findSharedRoadEvidence(first, second),
      ).toHaveLength(1);
    });
  });

  describe('assessRoadConflict', () => {
    it('supports a candidate at an evidenced intersection', () => {
      expect(
        assessRoadConflict(
          crossing,
          emergency,
          crossingDriver,
        ),
      ).toEqual({
        status: 'SUPPORTED',
        evidenceKind: 'SHARED_NODE',
      });
    });

    it('does not support a geometric crossing without shared node IDs', () => {
      const driver: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [
          node('201', SOUTH),
          node('999', B),
          node('203', NORTH),
        ],
      };

      expect(
        assessRoadConflict(
          crossing,
          emergency,
          driver,
        ),
      ).toEqual({
        status: 'UNVERIFIED',
      });
    });

    it('does not treat a distant shared node as proof of this crossing', () => {
      const driver: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [
          node('101', A),
          node('201', SOUTH),
          node('999', B),
        ],
      };

      expect(
        assessRoadConflict(
          crossing,
          emergency,
          driver,
        ),
      ).toEqual({
        status: 'UNVERIFIED',
      });
    });

    it('supports an encounter midway along a shared road edge', () => {
      const driver: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [
          node('102', B),
          node('103', C),
        ],
      };

      const middle = {
        latitude: B.latitude,
        longitude:
          (B.longitude + C.longitude) / 2,
      };

      const result = assessRoadConflict(
        {
          ...crossing,
          location: middle,
          reason: 'SHARED_PATH',
        },
        emergency,
        driver,
      );

      expect(result).toEqual({
        status: 'SUPPORTED',
        evidenceKind: 'SHARED_EDGE',
      });
    });

    it('rejects mismatched vehicle identities', () => {
      const wrong: VehicleRoadTopology = {
        ...crossingDriver,
        vehicleId: 'CAR-002',
      };

      expect(() =>
        assessRoadConflict(
          crossing,
          emergency,
          wrong,
        ),
      ).toThrow(/IDs do not match/);
    });

    it('rejects invalid geographic coordinates', () => {
      expect(() =>
        assessRoadConflict(
          {
            ...crossing,
            location: {
              latitude: 120,
              longitude: -75,
            },
          },
          emergency,
          crossingDriver,
        ),
      ).toThrow(RangeError);
    });
  });

  describe('topology evidence validation', () => {
    it('rejects invalid OSM node IDs', () => {
      const invalid: VehicleRoadTopology = {
        vehicleId: 'CAR-001',
        nodes: [node('12.5', B)],
      };

      expect(() =>
        findSharedRoadEvidence(
          emergency,
          invalid,
        ),
      ).toThrow(/positive integer strings/);
    });

    it('rejects invalid matching tolerance', () => {
      expect(() =>
        findSharedRoadEvidence(
          emergency,
          crossingDriver,
          -1,
        ),
      ).toThrow(RangeError);

      expect(() =>
        findSharedRoadEvidence(
          emergency,
          crossingDriver,
          Infinity,
        ),
      ).toThrow(RangeError);
    });
  });

  describe('filterTopologicallySupportedEncounters', () => {
    it('keeps only candidates supported by the correct vehicle pair', () => {
      const otherCandidate: EncounterCandidate = {
        ...crossing,
        civilianVehicleId: 'CAR-002',
      };

      const otherDriver: VehicleRoadTopology = {
        vehicleId: 'CAR-002',
        nodes: [
          node('201', SOUTH),
          node('999', B),
          node('203', NORTH),
        ],
      };

      const results =
        filterTopologicallySupportedEncounters(
          [crossing, otherCandidate],
          [
            emergency,
            crossingDriver,
            otherDriver,
          ],
        );

      expect(results).toEqual([crossing]);
    });

    it('fails closed when vehicle topology is missing', () => {
      expect(
        filterTopologicallySupportedEncounters(
          [crossing],
          [emergency],
        ),
      ).toEqual([]);
    });

    it('rejects duplicate vehicle topology records', () => {
      expect(() =>
        filterTopologicallySupportedEncounters(
          [crossing],
          [
            emergency,
            emergency,
            crossingDriver,
          ],
        ),
      ).toThrow(/Duplicate vehicle topology/);
    });

    it('does not mutate encounter inputs', () => {
      const initial = structuredClone(crossing);

      filterTopologicallySupportedEncounters(
        [crossing],
        [emergency, crossingDriver],
      );

      expect(crossing).toEqual(initial);
    });
  });
