import { describe, expect, it } from 'vitest';

import type { EncounterCandidate } from './encounter-detector.js';
import type { VehicleRoadTopology } from './road-topology.js';
import { selectAlertableEncounters } from './road-aware-encounters.js';

const B = { latitude: 39.683, longitude: -75.75 };

const crossing: EncounterCandidate = {
  emergencyVehicleId: 'AMB-001',
  civilianVehicleId: 'CAR-001',
  location: B,
  reason: 'CROSSING',
  emergencyEtaSeconds: 5,
  civilianEtaSeconds: 5.2,
  etaDifferenceSeconds: 0.2,
};

const emergency: VehicleRoadTopology = {
  vehicleId: 'AMB-001',
  nodes: [
    { id: '100', position: { latitude: 39.683, longitude: -75.751 } },
    { id: '102', position: B },
  ],
};

const civilian: VehicleRoadTopology = {
  vehicleId: 'CAR-001',
  nodes: [
    { id: '200', position: { latitude: 39.682, longitude: -75.75 } },
    { id: '102', position: B },
  ],
};

describe('selectAlertableEncounters', () => {
  it('preserves original geometric test-demo advisories', () => {
    expect(selectAlertableEncounters([crossing], 'DEMO', [])).toEqual([crossing]);
  });

  it('accepts OSRM crossing with matching OSM node evidence', () => {
    expect(selectAlertableEncounters([crossing], 'OSRM', [emergency, civilian]))
      .toEqual([crossing]);
  });

  it('suppresses an OSRM crossing at the same coordinate with different nodes', () => {
    const gradeSeparated: VehicleRoadTopology = {
      ...civilian,
      nodes: [
        civilian.nodes[0],
        { id: '999', position: B },
      ],
    };
    expect(selectAlertableEncounters([crossing], 'OSRM', [emergency, gradeSeparated]))
      .toEqual([]);
  });

  it('suppresses OSRM warnings when annotations are unavailable', () => {
    expect(selectAlertableEncounters([crossing], 'OSRM', [])).toEqual([]);
    expect(selectAlertableEncounters([crossing], 'OSRM', [
      { vehicleId: 'AMB-001', nodes: [] },
      civilian,
    ])).toEqual([]);
  });

  it('does not mutate the candidate array', () => {
    const source = [crossing];
    selectAlertableEncounters(source, 'OSRM', [emergency, civilian]);
    expect(source).toEqual([crossing]);
  });
});
