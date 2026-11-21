import type { GeoPosition } from '../../vehicles/domain/vehicle.js';

/**
 * Hand-authored, SYNTHETIC test labels. They were not generated from the detector,
 * OSRM, field observations, or real crash/incident reports.
 *
 * "expectedAlert" means that the scenario designer expects a qualifying
 * ambulance/driver route encounter within the configured prediction window.
 * The scenario designer specifies whether two geometrically crossing roads
 * connect at grade. Missing annotations DO NOT change physical ground truth.
 */
export interface LabeledVehicleRoute {
  readonly speedMps: number;
  readonly points: readonly GeoPosition[];
  /** null = an OSM node annotation is unavailable, not a disconnected road. */
  readonly nodeIds: readonly (string | null)[];
}

export interface LabeledEncounterScenario {
  readonly id: string;
  readonly category:
    | 'AT_GRADE_CROSSING'
    | 'SHARED_ROAD'
    | 'STATIONARY'
    | 'GRADE_SEPARATION'
    | 'TIMING'
    | 'BEHIND'
    | 'UNRELATED_ROAD'
    | 'ANNOTATION_GAP';
  readonly evidence: 'COMPLETE' | 'MISSING_ANNOTATION';
  readonly expectedAlert: boolean;
  readonly explanation: string;
  readonly ambulance: LabeledVehicleRoute;
  readonly civilian: LabeledVehicleRoute;
}

// Coordinates are deliberately schematic around Newark, Delaware.
// No claim is made that these polylines describe real streets at this location.
const A = { latitude: 39.683, longitude: -75.751 };
const X = { latitude: 39.683, longitude: -75.750 };
const E = { latitude: 39.683, longitude: -75.749 };
const S = { latitude: 39.682, longitude: -75.750 };
const N = { latitude: 39.684, longitude: -75.750 };
const P = { latitude: 39.6833, longitude: -75.751 };
const Q = { latitude: 39.6833, longitude: -75.749 };
const AFTER = { latitude: 39.6832, longitude: -75.750 };
const FAR_WEST = { latitude: 39.683, longitude: -75.763 };
const CLOSE_A = { latitude: 39.683012, longitude: -75.751 };
const CLOSE_E = { latitude: 39.683012, longitude: -75.749 };

const eastbound: LabeledVehicleRoute = {
  speedMps: 15,
  points: [A, X, E],
  nodeIds: ['101', '102', '103'],
};
const northbound: LabeledVehicleRoute = {
  speedMps: 20,
  points: [S, X, N],
  nodeIds: ['201', '102', '203'],
};

/** Explicit manual labels; the evaluator never derives labels from its predictions. */
export const LABELED_ENCOUNTER_SCENARIOS: readonly LabeledEncounterScenario[] = [
  {
    id: 'connected-crossing', category: 'AT_GRADE_CROSSING', evidence: 'COMPLETE',
    expectedAlert: true,
    explanation: 'Routes meet at an explicitly connected, at-grade node; predicted arrivals differ by under 5 seconds.',
    ambulance: eastbound, civilian: northbound,
  },
  {
    id: 'connected-crossing-from-north', category: 'AT_GRADE_CROSSING', evidence: 'COMPLETE',
    expectedAlert: true,
    explanation: 'Same connected crossing approached from the other direction at similar arrival times.',
    ambulance: eastbound,
    civilian: { speedMps: 20, points: [N, X, S], nodeIds: ['203', '102', '201'] },
  },
  {
    id: 'connected-crossing-different-speed', category: 'AT_GRADE_CROSSING', evidence: 'COMPLETE',
    expectedAlert: true,
    explanation: 'Approaches a connected intersection at 18 m/s, still inside the five-second arrival window.',
    ambulance: eastbound,
    civilian: { ...northbound, speedMps: 18 },
  },
  {
    id: 'slower-car-on-shared-road', category: 'SHARED_ROAD', evidence: 'COMPLETE',
    expectedAlert: true,
    explanation: 'Driver moves ahead along the same directed road and shares the road-node edge identities.',
    ambulance: eastbound,
    civilian: { speedMps: 8, points: [X, E], nodeIds: ['102', '103'] },
  },
  {
    id: 'opposing-traffic-on-shared-road', category: 'SHARED_ROAD', evidence: 'COMPLETE',
    expectedAlert: true,
    explanation: 'Routes share a directed edge in reverse; vehicle and ambulance converge at its west end.',
    ambulance: eastbound,
    civilian: { speedMps: 15, points: [E, X], nodeIds: ['103', '102'] },
  },
  {
    id: 'stopped-on-ambulance-route', category: 'STATIONARY', evidence: 'COMPLETE',
    expectedAlert: true,
    explanation: 'A stopped car occupies an upcoming, identity-connected point on the ambulance path.',
    ambulance: eastbound,
    civilian: { speedMps: 0, points: [X, E], nodeIds: ['102', '103'] },
  },
  {
    id: 'connected-crossing-with-missing-annotation', category: 'ANNOTATION_GAP',
    evidence: 'MISSING_ANNOTATION', expectedAlert: true,
    explanation: 'The scenario is physically at-grade, but the driver-side crossing node annotation is missing. A fail-closed abstention counts as a missed positive.',
    ambulance: eastbound,
    civilian: { ...northbound, nodeIds: ['201', null, '203'] },
  },
  {
    id: 'stopped-on-road-with-missing-annotation', category: 'ANNOTATION_GAP',
    evidence: 'MISSING_ANNOTATION', expectedAlert: true,
    explanation: 'The stopped car physically occupies the shared road point, but its node identity is unannotated. It remains a manually labeled positive.',
    ambulance: eastbound,
    civilian: { speedMps: 0, points: [X, E], nodeIds: [null, '909'] },
  },
  {
    id: 'overpass-without-junction', category: 'GRADE_SEPARATION', evidence: 'COMPLETE',
    expectedAlert: false,
    explanation: 'Plan-view polylines cross at X, but this case defines a grade-separated overpass with different network node identities.',
    ambulance: eastbound,
    civilian: { ...northbound, nodeIds: ['201', '999', '203'] },
  },
  {
    id: 'far-parallel-road', category: 'UNRELATED_ROAD', evidence: 'COMPLETE',
    expectedAlert: false,
    explanation: 'The civilian stays over 30 m north of the ambulance road, without any shared edge or junction.',
    ambulance: eastbound,
    civilian: { speedMps: 15, points: [P, Q], nodeIds: ['601', '602'] },
  },
  {
    id: 'geometrically-near-but-disconnected', category: 'UNRELATED_ROAD', evidence: 'COMPLETE',
    expectedAlert: false,
    explanation: 'The road centerlines lie within tolerance but represent different disconnected paths, as shown by distinct node identities.',
    ambulance: eastbound,
    civilian: { speedMps: 15, points: [CLOSE_A, CLOSE_E], nodeIds: ['801', '802'] },
  },
  {
    id: 'crossing-arrival-too-late', category: 'TIMING', evidence: 'COMPLETE',
    expectedAlert: false,
    explanation: 'The civilian approaches the same junction at 1 m/s: it arrives much too late for this prediction horizon.',
    ambulance: eastbound,
    civilian: { ...northbound, speedMps: 1 },
  },
  {
    id: 'crossing-outside-arrival-window', category: 'TIMING', evidence: 'COMPLETE',
    expectedAlert: false,
    explanation: 'Driver arrival is more than five seconds after the ambulance, despite shared junction geometry.',
    ambulance: eastbound,
    civilian: { ...northbound, speedMps: 5 },
  },
  {
    id: 'intersection-already-behind-driver', category: 'BEHIND', evidence: 'COMPLETE',
    expectedAlert: false,
    explanation: 'The car begins north of junction X and keeps traveling north. The shared intersection is behind it.',
    ambulance: eastbound,
    civilian: { speedMps: 20, points: [AFTER, N], nodeIds: ['701', '203'] },
  },
  {
    id: 'stationary-on-unrelated-road', category: 'STATIONARY', evidence: 'COMPLETE',
    expectedAlert: false,
    explanation: 'Stopped vehicle is off the emergency route and has no matching road node or edge.',
    ambulance: eastbound,
    civilian: { speedMps: 0, points: [P, Q], nodeIds: ['601', '602'] },
  },
  {
    id: 'ambulance-is-not-moving', category: 'TIMING', evidence: 'COMPLETE',
    expectedAlert: false,
    explanation: 'The emergency vehicle is stopped; the detector has no finite predicted ambulance arrival.',
    ambulance: { ...eastbound, speedMps: 0 },
    civilian: northbound,
  },
  {
    id: 'connected-crossing-beyond-horizon', category: 'TIMING', evidence: 'COMPLETE',
    expectedAlert: false,
    explanation: 'Ambulance is about a kilometer west of the intersection; it cannot arrive within the 45-second horizon at 15 m/s.',
    ambulance: { speedMps: 15, points: [FAR_WEST, X, E], nodeIds: ['501', '102', '103'] },
    civilian: northbound,
  },
];
