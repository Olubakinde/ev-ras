import { describe, expect, it } from 'vitest';
import {
  evaluateLabeledScenario,
  evaluateLabeledScenarios,
  scoreLabeledPredictions,
} from './accuracy-evaluator.js';
import { LABELED_ENCOUNTER_SCENARIOS } from './labeled-scenarios.js';

const byId = (id: string) => {
  const scenario = LABELED_ENCOUNTER_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Unknown fixture ${id}`);
  return scenario;
};

const obs = (id: string, expectedAlert: boolean, predictedAlert: boolean) => ({
  id, expectedAlert, predictedAlert,
});

describe('independently labeled synthetic scenario suite', () => {
  it('has unique, human-authored positive and negative labels', () => {
    const ids = LABELED_ENCOUNTER_SCENARIOS.map((item) => item.id);
    expect(ids.length).toBeGreaterThanOrEqual(16);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LABELED_ENCOUNTER_SCENARIOS.some((item) => item.expectedAlert)).toBe(true);
    expect(LABELED_ENCOUNTER_SCENARIOS.some((item) => !item.expectedAlert)).toBe(true);
    expect(LABELED_ENCOUNTER_SCENARIOS.every((item) => item.explanation.length > 40)).toBe(true);
  });

  it('classifies an identity-connected at-grade crossing as positive', () => {
    const result = evaluateLabeledScenario(byId('connected-crossing'));
    expect(result.expectedAlert).toBe(true);
    expect(result.predictedAlert).toBe(true);
    expect(result.outcome).toBe('TP');
    expect(result.reason).toBe('CROSSING');
  });

  it('identifies a plan-view overpass as geometric but not topology-supported', () => {
    const result = evaluateLabeledScenario(byId('overpass-without-junction'));
    expect(result.expectedAlert).toBe(false);
    expect(result.geometricCandidate).toBe(true);
    expect(result.predictedAlert).toBe(false);
    expect(result.suppressedByEvidence).toBe(true);
    expect(result.outcome).toBe('TN');
  });

  it('counts a physically connected crossing with missing node data as a false negative', () => {
    const result = evaluateLabeledScenario(byId('connected-crossing-with-missing-annotation'));
    expect(result.expectedAlert).toBe(true);
    expect(result.evidence).toBe('MISSING_ANNOTATION');
    expect(result.geometricCandidate).toBe(true);
    expect(result.predictedAlert).toBe(false);
    expect(result.outcome).toBe('FN');
  });

  it('keeps missing evidence independent of the human-authored ground-truth label', () => {
    const item = byId('stopped-on-road-with-missing-annotation');
    expect(item.expectedAlert).toBe(true);
    expect(item.civilian.nodeIds).toContain(null);
    const result = evaluateLabeledScenario(item);
    expect(result.predictedAlert).toBe(false);
    expect(result.outcome).toBe('FN');
  });

  it('rejects a late arrival even when node IDs prove connectivity', () => {
    const result = evaluateLabeledScenario(byId('crossing-arrival-too-late'));
    expect(result.outcome).toBe('TN');
    expect(result.geometricCandidate).toBe(false);
  });

  it('rejects a crossing that is already behind the moving civilian', () => {
    const result = evaluateLabeledScenario(byId('intersection-already-behind-driver'));
    expect(result.outcome).toBe('TN');
  });

  it('detects a stationary driver on a topology-connected emergency route', () => {
    const result = evaluateLabeledScenario(byId('stopped-on-ambulance-route'));
    expect(result.outcome).toBe('TP');
    expect(result.reason).toBe('STATIONARY_ON_PATH');
  });

  it('ignores a stationary vehicle off the route', () => {
    expect(evaluateLabeledScenario(byId('stationary-on-unrelated-road')).outcome).toBe('TN');
  });

  it('ignores an ambulance that is not moving', () => {
    expect(evaluateLabeledScenario(byId('ambulance-is-not-moving')).outcome).toBe('TN');
  });

  it('tests a shared directed edge and its opposite direction', () => {
    expect(evaluateLabeledScenario(byId('slower-car-on-shared-road')).predictedAlert).toBe(true);
    expect(evaluateLabeledScenario(byId('opposing-traffic-on-shared-road')).predictedAlert).toBe(true);
  });

  it('evaluates every fixture with real detector and topology gate', () => {
    const report = evaluateLabeledScenarios();
    expect(report.cases).toHaveLength(LABELED_ENCOUNTER_SCENARIOS.length);
    expect(report.metrics.samples).toBe(LABELED_ENCOUNTER_SCENARIOS.length);
    expect(report.metrics.truePositive + report.metrics.trueNegative +
      report.metrics.falsePositive + report.metrics.falseNegative).toBe(report.metrics.samples);
    expect(report.cases.some((item) => item.outcome === 'FN')).toBe(true);
  });

  it('keeps complete and missing-annotation groups separate', () => {
    const report = evaluateLabeledScenarios();
    expect(report.completeEvidenceMetrics.samples +
      report.missingAnnotationMetrics.samples).toBe(report.metrics.samples);
    expect(report.missingAnnotationMetrics.samples).toBe(2);
    expect(report.missingAnnotationMetrics.falseNegative).toBe(2);
  });

  it('does not change labels or result order when invoked twice', () => {
    expect(evaluateLabeledScenarios()).toEqual(evaluateLabeledScenarios());
  });

  it('rejects a malformed route/node alignment instead of silently dropping nodes', () => {
    const baseline = byId('connected-crossing');
    expect(() => evaluateLabeledScenario({
      ...baseline,
      civilian: { ...baseline.civilian, nodeIds: ['1'] },
    })).toThrow(/Invalid route\/node/);
  });

  it('rejects an empty fixture set', () => {
    expect(() => evaluateLabeledScenarios([])).toThrow(/No labeled scenarios/);
  });

  it('does not use the label as a detector input', () => {
    const original = byId('connected-crossing');
    const truth = evaluateLabeledScenario(original);
    const inverted = evaluateLabeledScenario({
      ...original,
      id: 'inverted-label-control',
      expectedAlert: !original.expectedAlert,
    });
    expect(inverted.predictedAlert).toBe(truth.predictedAlert);
    expect(inverted.outcome).toBe('FP');
  });
});

describe('confusion matrix mathematics', () => {
  it('calculates TP, FP, TN, and FN without relabeling detector outputs', () => {
    const metrics = scoreLabeledPredictions([
      obs('tp', true, true), obs('fp', false, true),
      obs('tn', false, false), obs('fn', true, false),
    ]);
    expect(metrics).toMatchObject({
      samples: 4, truePositive: 1, falsePositive: 1,
      trueNegative: 1, falseNegative: 1,
      precision: 0.5, recall: 0.5, specificity: 0.5,
      f1: 0.5, balancedAccuracy: 0.5,
    });
  });

  it('returns null when precision has no predicted-positive denominator', () => {
    const m = scoreLabeledPredictions([obs('fn', true, false), obs('tn', false, false)]);
    expect(m.precision).toBeNull();
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });

  it('returns null when recall has no real-positive denominator', () => {
    const m = scoreLabeledPredictions([obs('tn', false, false)]);
    expect(m.recall).toBeNull();
    expect(m.precision).toBeNull();
    expect(m.f1).toBeNull();
  });

  it('returns null when specificity has no real-negative denominator', () => {
    const m = scoreLabeledPredictions([obs('tp', true, true)]);
    expect(m.specificity).toBeNull();
    expect(m.balancedAccuracy).toBeNull();
  });

  it('calculates F1 directly from true positives and errors', () => {
    const m = scoreLabeledPredictions([
      obs('tp', true, true), obs('tp2', true, true),
      obs('fp', false, true), obs('fn', true, false),
    ]);
    expect(m.f1).toBeCloseTo(4 / 6);
  });

  it('rejects duplicated IDs, malformed fields, and empty input', () => {
    expect(() => scoreLabeledPredictions([])).toThrow();
    expect(() => scoreLabeledPredictions([obs('same', true, true), obs('same', false, false)])).toThrow();
    expect(() => scoreLabeledPredictions([{
      id: 'bad', expectedAlert: 1 as unknown as boolean, predictedAlert: true,
    }])).toThrow();
  });
});
