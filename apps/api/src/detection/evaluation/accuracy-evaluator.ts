import { detectEncounters } from '../domain/encounter-detector.js';
import { createRoadEvidenceGate } from '../domain/road-evidence-gate.js';
import type { VehicleRoadTopology } from '../domain/road-topology.js';
import { createRoadNetwork } from '../../simulation/domain/road-network.js';
import { createSimulation } from '../../simulation/domain/simulation.js';
import {
  LABELED_ENCOUNTER_SCENARIOS,
  type LabeledEncounterScenario,
  type LabeledVehicleRoute,
} from './labeled-scenarios.js';

export interface LabeledPrediction {
  readonly id: string;
  readonly expectedAlert: boolean;
  readonly predictedAlert: boolean;
}

export interface AccuracyMetrics {
  readonly samples: number;
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly trueNegative: number;
  readonly falseNegative: number;
  /** Rates are null if their denominator is zero, never silently 0 or 100%. */
  readonly precision: number | null;
  readonly recall: number | null;
  readonly specificity: number | null;
  readonly f1: number | null;
  readonly balancedAccuracy: number | null;
}

export interface ScenarioResult extends LabeledPrediction {
  readonly category: LabeledEncounterScenario['category'];
  readonly evidence: LabeledEncounterScenario['evidence'];
  readonly explanation: string;
  /** Geometry-only result for diagnostic comparison; NOT the production verdict. */
  readonly geometricCandidate: boolean;
  readonly suppressedByEvidence: boolean;
  readonly outcome: 'TP' | 'FP' | 'TN' | 'FN';
  readonly reason: string | null;
  readonly predictedEmergencyEtaSeconds: number | null;
}

export interface LabeledEvaluationReport {
  readonly evaluationKind: 'HAND_LABELED_SYNTHETIC_ROAD_CASES';
  readonly detector: 'TOPOLOGY_GATED_BASELINE';
  readonly metrics: AccuracyMetrics;
  readonly completeEvidenceMetrics: AccuracyMetrics;
  readonly missingAnnotationMetrics: AccuracyMetrics;
  readonly geometricOnlyMetrics: AccuracyMetrics;
  readonly cases: readonly ScenarioResult[];
  readonly limitations: readonly string[];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Pure scorer: the expected labels must come from an independent fixture. */
export function scoreLabeledPredictions(
  predictions: readonly LabeledPrediction[],
): AccuracyMetrics {
  if (predictions.length === 0) {
    throw new Error('At least one labeled prediction is required');
  }
  const seen = new Set<string>();
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const observation of predictions) {
    if (!observation.id.trim() || seen.has(observation.id)) {
      throw new Error(`Missing or duplicate case id: ${observation.id}`);
    }
    if (
      typeof observation.expectedAlert !== 'boolean' ||
      typeof observation.predictedAlert !== 'boolean'
    ) {
      throw new Error(`Expected and predicted alerts must be boolean: ${observation.id}`);
    }
    seen.add(observation.id);
    if (observation.expectedAlert && observation.predictedAlert) truePositive++;
    else if (!observation.expectedAlert && observation.predictedAlert) falsePositive++;
    else if (!observation.expectedAlert && !observation.predictedAlert) trueNegative++;
    else falseNegative++;
  }

  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const specificity = ratio(trueNegative, trueNegative + falsePositive);
  const f1 = ratio(2 * truePositive, 2 * truePositive + falsePositive + falseNegative);
  return {
    samples: predictions.length,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision,
    recall,
    specificity,
    f1,
    balancedAccuracy:
      recall !== null && specificity !== null ? (recall + specificity) / 2 : null,
  };
}

function makeTopology(
  vehicleId: string,
  route: LabeledVehicleRoute,
): VehicleRoadTopology {
  if (route.points.length !== route.nodeIds.length || route.points.length < 2) {
    throw new Error(`Invalid route/node fixtures for ${vehicleId}`);
  }
  return {
    vehicleId,
    nodes: route.nodeIds.flatMap((id, index) =>
      id === null ? [] : [{ id, position: route.points[index] }],
    ),
  };
}

/**
 * Runs the ACTUAL EV-RAS domain detector and the 11A topology gate.
 * The independently declared `expectedAlert` is never fed into either.
 */
export function evaluateLabeledScenario(
  scenario: LabeledEncounterScenario,
): ScenarioResult {
  const network = createRoadNetwork([
    { id: 'AMB-ROUTE', points: scenario.ambulance.points },
    { id: 'CAR-ROUTE', points: scenario.civilian.points },
  ]);
  const simulation = createSimulation(network, 0, [
    {
      vehicle: {
        id: 'AMB-001',
        kind: 'EMERGENCY',
        position: scenario.ambulance.points[0],
        speedMps: scenario.ambulance.speedMps,
        headingDeg: 90,
        timestampMs: 0,
      },
      route: ['AMB-ROUTE'],
    },
    {
      vehicle: {
        id: 'CAR-001',
        kind: 'CIVILIAN',
        position: scenario.civilian.points[0],
        speedMps: scenario.civilian.speedMps,
        headingDeg: 0,
        timestampMs: 0,
      },
      route: ['CAR-ROUTE'],
    },
  ]);
  const emergency = { network, state: simulation.vehicles[0] };
  const civilian = [{ network, state: simulation.vehicles[1] }];
  const topologies = [
    makeTopology('AMB-001', scenario.ambulance),
    makeTopology('CAR-001', scenario.civilian),
  ];

  // This geometric-only result is diagnostic and NOT the source of truth labels.
  const geometricCandidates = detectEncounters(emergency, civilian);
  const supportedCandidates = detectEncounters(
    emergency,
    civilian,
    {},
    createRoadEvidenceGate(topologies),
  );
  const predictedAlert = supportedCandidates.length > 0;
  const observation = supportedCandidates[0];
  const outcome: ScenarioResult['outcome'] = scenario.expectedAlert
    ? predictedAlert ? 'TP' : 'FN'
    : predictedAlert ? 'FP' : 'TN';

  return {
    id: scenario.id,
    category: scenario.category,
    evidence: scenario.evidence,
    expectedAlert: scenario.expectedAlert,
    predictedAlert,
    geometricCandidate: geometricCandidates.length > 0,
    suppressedByEvidence: geometricCandidates.length > 0 && !predictedAlert,
    outcome,
    explanation: scenario.explanation,
    reason: observation?.reason ?? null,
    predictedEmergencyEtaSeconds: observation?.emergencyEtaSeconds ?? null,
  };
}

export function evaluateLabeledScenarios(
  scenarios: readonly LabeledEncounterScenario[] = LABELED_ENCOUNTER_SCENARIOS,
): LabeledEvaluationReport {
  if (scenarios.length === 0) throw new Error('No labeled scenarios supplied');
  const cases = scenarios.map(evaluateLabeledScenario);
  const scored = cases.map(({ id, expectedAlert, predictedAlert }) => ({
    id, expectedAlert, predictedAlert,
  }));
  const complete = cases.filter((result) => result.evidence === 'COMPLETE');
  const missing = cases.filter((result) => result.evidence === 'MISSING_ANNOTATION');
  const select = (items: readonly ScenarioResult[]) =>
    items.length === 0
      ? scoreOrEmpty()
      : scoreLabeledPredictions(items);
  return {
    evaluationKind: 'HAND_LABELED_SYNTHETIC_ROAD_CASES',
    detector: 'TOPOLOGY_GATED_BASELINE',
    metrics: scoreLabeledPredictions(scored),
    completeEvidenceMetrics: select(complete),
    missingAnnotationMetrics: select(missing),
    geometricOnlyMetrics: scoreLabeledPredictions(
      cases.map(({ id, expectedAlert, geometricCandidate }) => ({
        id, expectedAlert, predictedAlert: geometricCandidate,
      })),
    ),
    cases,
    limitations: [
      'All labels are hand-authored scenarios, not independently observed real-road encounters.',
      'The road polylines and network-node identities are synthetic; no OSRM or live traffic is used.',
      'Precision and recall apply ONLY to this small, curated fixture set, not to field conditions.',
      'Missing OSM evidence causes fail-closed abstention; labeled physical positives can therefore be false negatives.',
      'One snapshot per scenario does not measure alert lead time, durability, or temporal tracking accuracy.',
      'A positive prediction is a modeled possible route encounter, not proof of a collision or required driver action.',
    ],
  };
}

function scoreOrEmpty(): AccuracyMetrics {
  return {
    samples: 0, truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0,
    precision: null, recall: null, specificity: null, f1: null, balancedAccuracy: null,
  };
}
