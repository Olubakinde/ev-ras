import { describe, expect, it } from 'vitest';
import { evaluateTemporalScenario, evaluateTemporalScenarios } from './temporal-evaluator.js';
import { ALL_TEMPORAL_SCENARIOS } from './temporal-scenarios.js';

const scene = (name: string) => {
  const found = ALL_TEMPORAL_SCENARIOS.find(item => item.id === name);
  if (!found) throw new Error(`Missing temporal fixture: ${name}`);
  return found;
};

describe('Milestone 15B opt-in temporal evaluation', () => {
  it('keeps the default constant-speed evaluation exactly identical', () => {
    const item = scene('early-synchronized-crossing');
    expect(evaluateTemporalScenario(item)).toEqual(evaluateTemporalScenario(item, 'BASELINE'));
  });
  it('never changes ground truth when ETA model changes', () => {
    const item = scene('both-slow-after-initial-warning');
    const baseline = evaluateTemporalScenario(item);
    const adaptive = evaluateTemporalScenario(item, 'ADAPTIVE');
    expect(adaptive.actualAmbulanceCrossingSeconds).toEqual(baseline.actualAmbulanceCrossingSeconds);
    expect(adaptive.actualCivilianCrossingSeconds).toEqual(baseline.actualCivilianCrossingSeconds);
    expect(adaptive.independentlyExpectedEncounter).toEqual(baseline.independentlyExpectedEncounter);
  });
  it('does not bypass the grade-separated OSM identity gate', () => {
    const item = scene('overpass-no-road-connection');
    expect(evaluateTemporalScenario(item, 'ADAPTIVE').anyWarningIssued).toBe(false);
  });
  it('does not invent missing road topology even in adaptive mode', () => {
    const item = scene('at-grade-missing-node-evidence');
    expect(evaluateTemporalScenario(item, 'ADAPTIVE').outcome).toBe('FN');
  });
  it('provides an opt-in aggregate without altering fixture definitions', () => {
    const input = [scene('early-synchronized-crossing'), scene('overpass-no-road-connection')];
    const baseline = evaluateTemporalScenarios(input);
    const adaptive = evaluateTemporalScenarios(input, 'ADAPTIVE');
    expect(baseline.metrics.samples).toBe(2);
    expect(adaptive.metrics.samples).toBe(2);
    expect(adaptive.cases.map(item => item.id)).toEqual(baseline.cases.map(item => item.id));
  });
});
