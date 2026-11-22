import { reconcileAlerts, type DriverAlert } from '../../alerts/domain/alert-manager.js';
import { detectEncounters } from '../domain/encounter-detector.js';
import { createRoadEvidenceGate } from '../domain/road-evidence-gate.js';
import { distanceMeters, getRoad, roadLengthMeters, createRoadNetwork } from '../../simulation/domain/road-network.js';
import { advanceSimulation, createSimulation, type SimulationState, type SimulatedVehicle } from '../../simulation/domain/simulation.js';
import type { VehicleRoadTopology } from '../domain/road-topology.js';
import { scoreLabeledPredictions, type AccuracyMetrics } from './accuracy-evaluator.js';
import {
  ALL_TEMPORAL_SCENARIOS,
  type TemporalEncounterScenario,
  type TemporalSpeedChange,
} from './temporal-scenarios.js';

const AMB = 'AMB-001';
const CAR = 'CAR-001';
const FINE_STEP_MS = 100;
const DETECTOR_STEP_MS = 1000;
const MAX_SECONDS = 80;
const CONFLICT_WINDOW_SECONDS = 5;
const LATE_THRESHOLD_SECONDS = 10;

type TimedAlertEvent = {
  readonly timeSeconds: number;
  readonly type: 'CREATED' | 'UPDATED' | 'CLEARED';
  readonly emergencyEtaSeconds: number;
  readonly reason: string;
};

export interface TemporalCaseResult {
  readonly id: string;
  readonly explanation: string;
  readonly physicalConnectivity: TemporalEncounterScenario['physicalConnectivity'];
  readonly evidence: TemporalEncounterScenario['evidence'];
  /** Independent arrival times from advancing the simulator, not detectEncounters ETA. */
  readonly actualAmbulanceCrossingSeconds: number | null;
  readonly actualCivilianCrossingSeconds: number | null;
  readonly actualArrivalDifferenceSeconds: number | null;
  /** Connected at grade, with both crossings occurring within 5 simulated seconds. */
  readonly independentlyExpectedEncounter: boolean;
  readonly anyWarningIssued: boolean;
  readonly outcome: 'TP' | 'FP' | 'TN' | 'FN';
  readonly warningCount: number;
  readonly clearedCount: number;
  readonly firstWarningAtSeconds: number | null;
  /** Time from first warning to actual AMB arrival. Negative means warning after arrival. */
  readonly warningLeadSeconds: number | null;
  readonly lateWarning: boolean | null;
  /** ETA that the detector predicted at the moment the first warning was created. */
  readonly predictedAmbulanceEtaAtCreationSeconds: number | null;
  /** Signed ETA error: (warning time + predicted ETA) - actual AMB arrival. */
  readonly etaPredictionErrorSeconds: number | null;
  readonly events: readonly TimedAlertEvent[];
}

export interface TemporalNumericSummary {
  readonly count: number;
  readonly min: number | null;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p90: number | null;
  readonly max: number | null;
}

export interface TemporalEvaluationReport {
  readonly evaluationKind: 'INDEPENDENT_SIMULATED_CROSSING_TIMES';
  readonly simulation: {
    readonly detectorStepMs: number;
    readonly independentArrivalStepMs: number;
    readonly durationSeconds: number;
    readonly conflictWindowSeconds: number;
    readonly lateThresholdSeconds: number;
  };
  readonly metrics: AccuracyMetrics;
  readonly actualPositiveCases: number;
  readonly lateTruePositiveWarnings: number;
  readonly warningLeadSeconds: TemporalNumericSummary;
  readonly absoluteEtaPredictionErrorSeconds: TemporalNumericSummary;
  readonly cases: readonly TemporalCaseResult[];
  readonly limitations: readonly string[];
}

export function summarizeTemporalNumbers(values: readonly number[]): TemporalNumericSummary {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError('Temporal measurements must be finite');
  }
  if (values.length === 0) {
    return { count: 0, min: null, mean: null, median: null, p90: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const interpolate = (p: number): number => {
    const rank = (sorted.length - 1) * p;
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  };
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    median: interpolate(0.5),
    p90: interpolate(0.9),
    max: sorted[sorted.length - 1],
  };
}

function validateScenario(scenario: TemporalEncounterScenario): void {
  if (!scenario.id.trim()) throw new Error('Temporal scenario must have a nonempty id');
  for (const route of [scenario.ambulance, scenario.civilian]) {
    if (route.points.length !== 3 || route.nodeIds.length !== 3 ||
      route.points[1].latitude !== scenario.crossing.latitude ||
      route.points[1].longitude !== scenario.crossing.longitude ||
      !Number.isFinite(route.speedMps) || route.speedMps < 0) {
      throw new Error(`Invalid crossing or route geometry: ${scenario.id}`);
    }
  }
  for (const changes of [scenario.ambulanceSpeedChanges, scenario.civilianSpeedChanges]) {
    let previous = -1;
    for (const entry of changes ?? []) {
      if (!Number.isInteger(entry.atSeconds) || entry.atSeconds < 0 ||
        entry.atSeconds >= MAX_SECONDS || entry.atSeconds <= previous ||
        !Number.isFinite(entry.speedMps) || entry.speedMps < 0) {
        throw new RangeError(`Invalid speed schedule: ${scenario.id}`);
      }
      previous = entry.atSeconds;
    }
  }
}

function speedAt(start: number, changes: readonly TemporalSpeedChange[] | undefined, seconds: number): number {
  let speed = start;
  for (const change of changes ?? []) {
    if (change.atSeconds > seconds + 1e-9) break;
    speed = change.speedMps;
  }
  return speed;
}

function applyScheduledSpeeds(state: SimulationState, scene: TemporalEncounterScenario): SimulationState {
  const nowSeconds = state.timeMs / 1000;
  const vehicles = state.vehicles.map((entry): SimulatedVehicle => ({
    ...entry,
    vehicle: {
      ...entry.vehicle,
      speedMps: entry.finished ? 0 :
        entry.vehicle.id === AMB
          ? speedAt(scene.ambulance.speedMps, scene.ambulanceSpeedChanges, nowSeconds)
          : speedAt(scene.civilian.speedMps, scene.civilianSpeedChanges, nowSeconds),
    },
  }));
  return { ...state, vehicles };
}

function createScene(scene: TemporalEncounterScenario) {
  const network = createRoadNetwork([
    { id: 'AMB-ROAD', points: scene.ambulance.points },
    { id: 'CAR-ROAD', points: scene.civilian.points },
  ]);
  const state = createSimulation(network, 0, [
    {
      vehicle: {
        id: AMB, kind: 'EMERGENCY' as const, position: scene.ambulance.points[0],
        speedMps: scene.ambulance.speedMps, headingDeg: 90, timestampMs: 0,
      },
      route: ['AMB-ROAD'],
    },
    {
      vehicle: {
        id: CAR, kind: 'CIVILIAN' as const, position: scene.civilian.points[0],
        speedMps: scene.civilian.speedMps, headingDeg: 0, timestampMs: 0,
      },
      route: ['CAR-ROAD'],
    },
  ]);
  const topology: readonly VehicleRoadTopology[] = [
    { vehicleId: AMB, nodes: scene.ambulance.nodeIds.flatMap((id, i) => id === null ? [] : [{ id, position: scene.ambulance.points[i] }]) },
    { vehicleId: CAR, nodes: scene.civilian.nodeIds.flatMap((id, i) => id === null ? [] : [{ id, position: scene.civilian.points[i] }]) },
  ];
  return { network, state, gate: createRoadEvidenceGate(topology) };
}

/**
 * Ground-truth crossing time: advance the actual simulation at 100 ms intervals,
 * then interpolate between its last state before the landmark and first state
 * beyond it. Never reads detector candidates, predicted ETAs, or alert events.
 */
export function measureSimulatedArrivals(scene: TemporalEncounterScenario): {
  ambulanceSeconds: number | null;
  civilianSeconds: number | null;
} {
  validateScenario(scene);
  const { network, state: initial } = createScene(scene);
  let state = initial;
  const thresholds = [
    distanceMeters(scene.ambulance.points[0], scene.crossing),
    distanceMeters(scene.civilian.points[0], scene.crossing),
  ];
  const arrivals: (number | null)[] = [null, null];
  for (let timeMs = 0; timeMs < MAX_SECONDS * 1000; timeMs += FINE_STEP_MS) {
    state = applyScheduledSpeeds(state, scene);
    const future = advanceSimulation(network, state, FINE_STEP_MS);
    for (let i = 0; i < 2; i++) {
      if (arrivals[i] !== null) continue;
      const road = getRoad(network, i === 0 ? 'AMB-ROAD' : 'CAR-ROAD');
      const progress = (entry: SimulatedVehicle) => entry.finished
        ? roadLengthMeters(road)
        : entry.distanceOnSegmentM;
      const before = progress(state.vehicles[i]);
      const after = progress(future.vehicles[i]);
      const target = thresholds[i];
      if (before <= target + 1e-8 && after >= target - 1e-8 && after > before) {
        const fraction = Math.max(0, Math.min(1, (target - before) / (after - before)));
        arrivals[i] = (timeMs + FINE_STEP_MS * fraction) / 1000;
      }
    }
    state = future;
    if (arrivals.every((value) => value !== null)) break;
  }
  return { ambulanceSeconds: arrivals[0], civilianSeconds: arrivals[1] };
}

export function evaluateTemporalScenario(scene: TemporalEncounterScenario): TemporalCaseResult {
  validateScenario(scene);
  const actual = measureSimulatedArrivals(scene);
  const arrivalGap = actual.ambulanceSeconds !== null && actual.civilianSeconds !== null
    ? Math.abs(actual.ambulanceSeconds - actual.civilianSeconds) : null;
  const independentlyExpectedEncounter = scene.physicalConnectivity === 'AT_GRADE' &&
    arrivalGap !== null && arrivalGap <= CONFLICT_WINDOW_SECONDS;

  const { network, gate, state: initial } = createScene(scene);
  let state = initial;
  let active: readonly DriverAlert[] = [];
  const events: TimedAlertEvent[] = [];
  for (let timeMs = 0; timeMs <= MAX_SECONDS * 1000; timeMs += DETECTOR_STEP_MS) {
    state = applyScheduledSpeeds(state, scene);
    const candidates = detectEncounters(
      { network, state: state.vehicles[0] },
      [{ network, state: state.vehicles[1] }],
      {}, gate,
    );
    const reconciled = reconcileAlerts(active, candidates, timeMs);
    active = reconciled.active;
    for (const event of reconciled.events) {
      events.push({
        type: event.type,
        timeSeconds: timeMs / 1000,
        emergencyEtaSeconds: event.alert.emergencyEtaSeconds,
        reason: event.alert.reason,
      });
    }
    if (timeMs < MAX_SECONDS * 1000) {
      state = advanceSimulation(network, state, DETECTOR_STEP_MS);
    }
  }
  const first = events.find((event) => event.type === 'CREATED');
  const anyWarningIssued = first !== undefined;
  const warningLeadSeconds = first && actual.ambulanceSeconds !== null
    ? actual.ambulanceSeconds - first.timeSeconds : null;
  const etaPredictionErrorSeconds = first && actual.ambulanceSeconds !== null
    ? first.timeSeconds + first.emergencyEtaSeconds - actual.ambulanceSeconds : null;
  const outcome = independentlyExpectedEncounter
    ? anyWarningIssued ? 'TP' : 'FN'
    : anyWarningIssued ? 'FP' : 'TN';
  return {
    id: scene.id,
    explanation: scene.explanation,
    physicalConnectivity: scene.physicalConnectivity,
    evidence: scene.evidence,
    actualAmbulanceCrossingSeconds: actual.ambulanceSeconds,
    actualCivilianCrossingSeconds: actual.civilianSeconds,
    actualArrivalDifferenceSeconds: arrivalGap,
    independentlyExpectedEncounter,
    anyWarningIssued,
    outcome,
    warningCount: events.filter((event) => event.type === 'CREATED').length,
    clearedCount: events.filter((event) => event.type === 'CLEARED').length,
    firstWarningAtSeconds: first?.timeSeconds ?? null,
    warningLeadSeconds,
    lateWarning: independentlyExpectedEncounter && anyWarningIssued && warningLeadSeconds !== null
      ? warningLeadSeconds < LATE_THRESHOLD_SECONDS : null,
    predictedAmbulanceEtaAtCreationSeconds: first?.emergencyEtaSeconds ?? null,
    etaPredictionErrorSeconds,
    events,
  };
}

export function evaluateTemporalScenarios(
  scenes: readonly TemporalEncounterScenario[] = ALL_TEMPORAL_SCENARIOS,
): TemporalEvaluationReport {
  if (!scenes.length) throw new Error('At least one temporal scenario is required');
  const ids = new Set<string>();
  const cases = scenes.map((scene) => {
    if (ids.has(scene.id)) throw new Error(`Duplicate temporal case id: ${scene.id}`);
    ids.add(scene.id);
    return evaluateTemporalScenario(scene);
  });
  const metrics = scoreLabeledPredictions(cases.map((item) => ({
    id: item.id, expectedAlert: item.independentlyExpectedEncounter, predictedAlert: item.anyWarningIssued,
  })));
  const truePositive = cases.filter((item) => item.outcome === 'TP');
  return {
    evaluationKind: 'INDEPENDENT_SIMULATED_CROSSING_TIMES',
    simulation: {
      detectorStepMs: DETECTOR_STEP_MS, independentArrivalStepMs: FINE_STEP_MS,
      durationSeconds: MAX_SECONDS, conflictWindowSeconds: CONFLICT_WINDOW_SECONDS,
      lateThresholdSeconds: LATE_THRESHOLD_SECONDS,
    },
    metrics,
    actualPositiveCases: cases.filter((item) => item.independentlyExpectedEncounter).length,
    lateTruePositiveWarnings: truePositive.filter((item) => item.lateWarning).length,
    warningLeadSeconds: summarizeTemporalNumbers(truePositive.flatMap((item) =>
      item.warningLeadSeconds === null ? [] : [item.warningLeadSeconds])),
    absoluteEtaPredictionErrorSeconds: summarizeTemporalNumbers(truePositive.flatMap((item) =>
      item.etaPredictionErrorSeconds === null ? [] : [Math.abs(item.etaPredictionErrorSeconds)])),
    cases,
    limitations: [
      'All route geometry, physical connectivity labels and speed profiles are synthetic and manually authored.',
      'Independent arrival times use the same deterministic simulation motion model, but never read detector ETAs or warning outcomes.',
      'A modeled at-grade crossing within five seconds is the test policy label; it is not a collision or observed emergency.',
      'Warning lead time is first CREATED time to simulated ambulance junction arrival, not measured human reaction time.',
      'The ten-second late threshold is an evaluation benchmark chosen for this study, not an established road-safety standard.',
      'One-second detection sampling and 100-millisecond arrival interpolation introduce finite timing resolution.',
      'Negative cases with an early warning are false positives relative to the final speed profile, not claims about field performance.',
      'These results are not real-world precision, recall, warning usefulness, or collision-prevention evidence.',
    ],
  };
}
