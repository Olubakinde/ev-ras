import { describe, expect, it } from 'vitest';
import { reconcileAlerts } from '../../alerts/domain/alert-manager.js';
import { createRoadNetwork } from '../../simulation/domain/road-network.js';
import { createSimulation } from '../../simulation/domain/simulation.js';
import { detectEncounters, type EncounterCandidate } from './encounter-detector.js';
import { createRoadEvidenceGate } from './road-evidence-gate.js';
import type { VehicleRoadTopology } from './road-topology.js';

// All geometry is a SYNTHETIC unit-test fixture, not OSRM street evidence.
const A = { latitude: 39.683, longitude: -75.751 };
const X1 = { latitude: 39.683, longitude: -75.7506 };
const X2 = { latitude: 39.683, longitude: -75.7502 };
const END = { latitude: 39.683, longitude: -75.7498 };
const S1 = { latitude: 39.6828, longitude: -75.7506 };
const N1 = { latitude: 39.6832, longitude: -75.7506 };
const N2 = { latitude: 39.6832, longitude: -75.7502 };
const S2 = { latitude: 39.6828, longitude: -75.7502 };
const OTHER_START = { latitude: 39.688, longitude: -75.751 };
const OTHER_END = { latitude: 39.688, longitude: -75.749 };

const ambulanceRoute = [A, X1, X2, END];
const driverRoute = [S1, X1, N1, N2, X2, S2];

function makeFixture(driverSpeed = 17) {
  const network = createRoadNetwork([
    { id: 'AMB', points: ambulanceRoute },
    { id: 'CAR', points: driverRoute },
    { id: 'OTHER', points: [OTHER_START, OTHER_END] },
  ]);
  const simulation = createSimulation(network, 0, [
    {
      vehicle: {
        id: 'AMB-001', kind: 'EMERGENCY', position: A,
        speedMps: 15, headingDeg: 90, timestampMs: 0,
      },
      route: ['AMB'],
    },
    {
      vehicle: {
        id: 'CAR-001', kind: 'CIVILIAN', position: S1,
        speedMps: driverSpeed, headingDeg: 0, timestampMs: 0,
      },
      route: ['CAR'],
    },
    {
      vehicle: {
        id: 'CAR-002', kind: 'CIVILIAN', position: OTHER_START,
        speedMps: 10, headingDeg: 90, timestampMs: 0,
      },
      route: ['OTHER'],
    },
  ]);

  const node = (id: string, position: { latitude: number; longitude: number }) =>
    ({ id, position });
  const topologies: VehicleRoadTopology[] = [
    {
      vehicleId: 'AMB-001',
      nodes: [node('101', A), node('102', X1), node('200', X2), node('103', END)],
    },
    {
      vehicleId: 'CAR-001',
      // Exact geometric crossing X1 intentionally has DIFFERENT OSM IDs.
      // Crossing X2 is the only identity-supported intersection.
      nodes: [
        node('301', S1), node('999', X1), node('302', N1),
        node('303', N2), node('200', X2), node('304', S2),
      ],
    },
    {
      vehicleId: 'CAR-002', nodes: [node('401', OTHER_START), node('402', OTHER_END)],
    },
  ];
  const [emergency, ...civilians] = simulation.vehicles;
  return {
    emergency: { network, state: emergency },
    civilians: civilians.map((state) => ({ network, state })),
    topologies,
  };
}

function candidateAt(location: { latitude: number; longitude: number }, driver = 'CAR-001'): EncounterCandidate {
  return {
    emergencyVehicleId: 'AMB-001', civilianVehicleId: driver,
    reason: 'CROSSING', location,
    emergencyEtaSeconds: 4, civilianEtaSeconds: 4,
    etaDifferenceSeconds: 0,
  };
}

describe('topology-gated encounter selection', () => {
  it('rejects an earlier unsupported crossing but selects a later supported one', () => {
    const scene = makeFixture();
    const legacy = detectEncounters(scene.emergency, scene.civilians);
    expect(legacy).toHaveLength(1);
    // Legacy selection favours the first crossing's closer arrival times.
    expect(Math.abs(legacy[0].location.longitude - X1.longitude)).toBeLessThan(0.00005);

    const gate = createRoadEvidenceGate(scene.topologies);
    const selected = detectEncounters(scene.emergency, scene.civilians, {}, gate);
    expect(selected).toHaveLength(1);
    expect(selected[0].civilianVehicleId).toBe('CAR-001');
    expect(Math.abs(selected[0].location.longitude - X2.longitude)).toBeLessThan(0.00005);
  });

  it('does not accept geometric proximity with different node identities', () => {
    const scene = makeFixture();
    const gate = createRoadEvidenceGate(scene.topologies);
    expect(gate(candidateAt(X1))).toBe(false);
    expect(gate(candidateAt(X2))).toBe(true);
    expect(gate(candidateAt(OTHER_START, 'CAR-002'))).toBe(false);
  });

  it('rejects a shared node elsewhere that does not support the selected location', () => {
    const scene = makeFixture();
    const gate = createRoadEvidenceGate(scene.topologies);
    expect(gate(candidateAt(X1))).toBe(false);
  });

  it('fails closed when topology is missing', () => {
    const scene = makeFixture();
    const gate = createRoadEvidenceGate(scene.topologies.filter((item) => item.vehicleId !== 'CAR-001'));
    expect(gate(candidateAt(X2))).toBe(false);
  });

  it('fails closed when OSM identities share a number but not a location', () => {
    const scene = makeFixture();
    const moved = scene.topologies.map((item) => item.vehicleId === 'CAR-001'
      ? { ...item, nodes: item.nodes.map((node) => node.id === '200'
          ? { ...node, position: S1 } : node) }
      : item);
    const gate = createRoadEvidenceGate(moved);
    expect(gate(candidateAt(X2))).toBe(false);
  });

  it('does not emit a candidate for an unrelated driver', () => {
    const scene = makeFixture();
    const gate = createRoadEvidenceGate(scene.topologies);
    const selected = detectEncounters(scene.emergency, scene.civilians, {}, gate);
    expect(selected.map((encounter) => encounter.civilianVehicleId)).toEqual(['CAR-001']);
  });

  it('preserves the existing geometric-only API when no gate is passed', () => {
    const scene = makeFixture();
    const first = detectEncounters(scene.emergency, scene.civilians);
    const second = detectEncounters(scene.emergency, scene.civilians, {});
    expect(second).toEqual(first);
  });

  it('gates stationary-car candidates too', () => {
    const scene = makeFixture(0);
    // Stationary car at S1 is not on the ambulance path; none are selected.
    const selected = detectEncounters(scene.emergency, scene.civilians, {},
      createRoadEvidenceGate(scene.topologies));
    expect(selected).toEqual([]);
  });

  it('applies the gate to a stationary car on the ambulance route', () => {
    const network = createRoadNetwork([
      { id: 'AMB', points: ambulanceRoute },
      { id: 'CAR', points: [X1, N1] },
    ]);
    const simulation = createSimulation(network, 0, [
      { vehicle: {
        id: 'AMB-001', kind: 'EMERGENCY', position: A,
        speedMps: 15, headingDeg: 90, timestampMs: 0,
      }, route: ['AMB'] },
      { vehicle: {
        id: 'CAR-001', kind: 'CIVILIAN', position: X1,
        speedMps: 0, headingDeg: 0, timestampMs: 0,
      }, route: ['CAR'] },
    ]);
    const emergency = { network, state: simulation.vehicles[0] };
    const civilians = [{ network, state: simulation.vehicles[1] }];
    const legacy = detectEncounters(emergency, civilians);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].reason).toBe('STATIONARY_ON_PATH');
    const gate = createRoadEvidenceGate([
      { vehicleId: 'AMB-001', nodes: [{ id: '102', position: X1 }] },
      { vehicleId: 'CAR-001', nodes: [{ id: '999', position: X1 }] },
    ]);
    expect(detectEncounters(emergency, civilians, {}, gate)).toEqual([]);
  });

  it('retains stationary-driver candidates at a supported shared node', () => {
    const network = createRoadNetwork([
      { id: 'AMB', points: ambulanceRoute },
      { id: 'CAR', points: [X2, S2] },
    ]);
    const simulation = createSimulation(network, 0, [
      { vehicle: {
        id: 'AMB-001', kind: 'EMERGENCY', position: A,
        speedMps: 15, headingDeg: 90, timestampMs: 0,
      }, route: ['AMB'] },
      { vehicle: {
        id: 'CAR-001', kind: 'CIVILIAN', position: X2,
        speedMps: 0, headingDeg: 0, timestampMs: 0,
      }, route: ['CAR'] },
    ]);
    const gate = createRoadEvidenceGate([
      { vehicleId: 'AMB-001', nodes: [{ id: '200', position: X2 }] },
      { vehicleId: 'CAR-001', nodes: [{ id: '200', position: X2 }] },
    ]);
    expect(detectEncounters(
      { network, state: simulation.vehicles[0] },
      [{ network, state: simulation.vehicles[1] }], {}, gate,
    )[0]?.reason).toBe('STATIONARY_ON_PATH');
  });

  it('keeps the existing created-and-cleared alert lifecycle', () => {
    const scene = makeFixture();
    const selected = detectEncounters(scene.emergency, scene.civilians, {},
      createRoadEvidenceGate(scene.topologies));
    const created = reconcileAlerts([], selected, 1000);
    expect(created.events.map((event) => event.type)).toEqual(['CREATED']);
    expect(created.active.map((alert) => alert.civilianVehicleId)).toEqual(['CAR-001']);
    const cleared = reconcileAlerts(created.active, [], 2000);
    expect(cleared.events.map((event) => event.type)).toEqual(['CLEARED']);
    expect(cleared.active).toHaveLength(0);
  });

  it('rejects duplicate topology entries instead of silently overriding evidence', () => {
    const scene = makeFixture();
    expect(() => createRoadEvidenceGate([...scene.topologies, scene.topologies[1]]))
      .toThrow(/Duplicate vehicle topology/);
  });

  it('is deterministic across multiple fresh selections', () => {
    const scene = makeFixture();
    const run = () => detectEncounters(scene.emergency, scene.civilians, {},
      createRoadEvidenceGate(scene.topologies));
    expect(run()).toEqual(run());
  });
});
