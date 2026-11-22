import { describe, expect, it } from 'vitest';
import {
  evaluateTemporalScenario,
  evaluateTemporalScenarios,
  measureSimulatedArrivals,
  summarizeTemporalNumbers,
} from './temporal-evaluator.js';
import { ALL_TEMPORAL_SCENARIOS } from './temporal-scenarios.js';

function fixture(id: string) {
  const item = ALL_TEMPORAL_SCENARIOS.find((scenario) => scenario.id === id);
  if (!item) throw new Error(`Missing temporal scenario: ${id}`);
  return item;
}

describe('independent crossing-time measurement', () => {
  it('uses valid numeric node IDs while preserving connection and missing-evidence labels', () => {
    for (const scene of ALL_TEMPORAL_SCENARIOS) {
      for (const route of [scene.ambulance, scene.civilian]) {
        expect(route.nodeIds).toHaveLength(route.points.length);
        for (const id of route.nodeIds) {
          if (id !== null) expect(id).toMatch(/^[1-9]\d*$/);
        }
      }
      const ambCross = scene.ambulance.nodeIds[1];
      const carCross = scene.civilian.nodeIds[1];
      if (scene.evidence === 'MISSING_ANNOTATION') {
        expect(carCross).toBeNull();
      } else if (scene.physicalConnectivity === 'GRADE_SEPARATED') {
        expect(carCross).not.toBe(ambCross);
      } else {
        expect(carCross).toBe(ambCross);
      }
    }
  });

  it('uses a distinct, explicitly defined crossing for each synthetic fixture', () => {
    expect(ALL_TEMPORAL_SCENARIOS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ALL_TEMPORAL_SCENARIOS.map((item) => item.id)).size).toBe(ALL_TEMPORAL_SCENARIOS.length);
    for (const item of ALL_TEMPORAL_SCENARIOS) {
      expect(item.ambulance.points[1]).toEqual(item.crossing);
      expect(item.civilian.points[1]).toEqual(item.crossing);
    }
  });

  it('measures real simulated arrival times without reading detector ETA', () => {
    const times = measureSimulatedArrivals(fixture('early-synchronized-crossing'));
    expect(times.ambulanceSeconds).toBeGreaterThan(15);
    expect(times.ambulanceSeconds).toBeLessThan(19);
    expect(times.civilianSeconds).toBeGreaterThan(15);
    expect(times.civilianSeconds).toBeLessThan(19);
    expect(Math.abs(times.ambulanceSeconds! - times.civilianSeconds!)).toBeLessThan(1);
  });

  it('measures a short actual travel time for the late-arrival case', () => {
    const actual = measureSimulatedArrivals(fixture('late-synchronized-crossing'));
    expect(actual.ambulanceSeconds).toBeGreaterThan(2);
    expect(actual.ambulanceSeconds).toBeLessThan(5);
  });

  it('treats a stopped ambulance as never arriving', () => {
    expect(measureSimulatedArrivals(fixture('stationary-emergency-vehicle')).ambulanceSeconds).toBeNull();
  });

  it('reproduces results exactly for identical speed schedules', () => {
    const scene = fixture('civilian-stop-and-go');
    expect(measureSimulatedArrivals(scene)).toEqual(measureSimulatedArrivals(scene));
  });

  it('detects slowing after start in the independent trajectory', () => {
    const baseline = measureSimulatedArrivals(fixture('early-synchronized-crossing'));
    const braking = measureSimulatedArrivals(fixture('civilian-brakes-after-warning'));
    expect(braking.civilianSeconds!).toBeGreaterThan(baseline.civilianSeconds! + 10);
  });

  it('detects two vehicles slowing and arriving later than initially predicted', () => {
    const baseline = measureSimulatedArrivals(fixture('early-synchronized-crossing'));
    const both = measureSimulatedArrivals(fixture('both-slow-after-initial-warning'));
    expect(both.ambulanceSeconds!).toBeGreaterThan(baseline.ambulanceSeconds! + 8);
    expect(Math.abs(both.ambulanceSeconds! - both.civilianSeconds!)).toBeLessThan(5);
  });

  it('rejects an unsorted or duplicate speed schedule', () => {
    const scene = fixture('early-synchronized-crossing');
    expect(() => measureSimulatedArrivals({
      ...scene,
      civilianSpeedChanges: [{ atSeconds: 7, speedMps: 10 }, { atSeconds: 7, speedMps: 15 }],
    })).toThrow(/speed schedule/i);
  });

  it('rejects malformed independent crossing geometry', () => {
    const scene = fixture('early-synchronized-crossing');
    expect(() => measureSimulatedArrivals({
      ...scene,
      ambulance: { ...scene.ambulance, points: scene.ambulance.points.slice(0, 2) },
    })).toThrow(/crossing or route geometry/);
  });
});

describe('time-based detector and alert lifecycle', () => {
  it('detects a physically synchronized junction with a substantial lead', () => {
    const result = evaluateTemporalScenario(fixture('early-synchronized-crossing'));
    expect(result.independentlyExpectedEncounter).toBe(true);
    expect(result.anyWarningIssued).toBe(true);
    expect(result.outcome).toBe('TP');
    expect(result.warningLeadSeconds).toBeGreaterThan(10);
    expect(result.lateWarning).toBe(false);
  });

  it('flags warnings issued under the chosen ten-second benchmark', () => {
    const result = evaluateTemporalScenario(fixture('late-synchronized-crossing'));
    expect(result.independentlyExpectedEncounter).toBe(true);
    expect(result.anyWarningIssued).toBe(true);
    expect(result.lateWarning).toBe(true);
    expect(result.warningLeadSeconds).toBeLessThan(10);
  });

  it('rejects a grade-separated crossing even with simultaneous coordinate arrivals', () => {
    const result = evaluateTemporalScenario(fixture('overpass-no-road-connection'));
    expect(result.actualArrivalDifferenceSeconds).toBeLessThan(5);
    expect(result.independentlyExpectedEncounter).toBe(false);
    expect(result.anyWarningIssued).toBe(false);
    expect(result.outcome).toBe('TN');
  });

  it('counts missing annotations as a missed positive, not a correct negative', () => {
    const result = evaluateTemporalScenario(fixture('at-grade-missing-node-evidence'));
    expect(result.independentlyExpectedEncounter).toBe(true);
    expect(result.anyWarningIssued).toBe(false);
    expect(result.outcome).toBe('FN');
    expect(result.warningLeadSeconds).toBeNull();
  });

  it('does not warn for strongly mismatched actual arrival times', () => {
    const result = evaluateTemporalScenario(fixture('civilian-arrives-too-late'));
    expect(result.independentlyExpectedEncounter).toBe(false);
    expect(result.actualArrivalDifferenceSeconds).toBeGreaterThan(5);
    expect(result.outcome).toBe('TN');
  });

  it('scores a warning invalidated by subsequent braking as false positive against final motion', () => {
    const result = evaluateTemporalScenario(fixture('civilian-brakes-after-warning'));
    expect(result.independentlyExpectedEncounter).toBe(false);
    expect(result.anyWarningIssued).toBe(true);
    expect(result.outcome).toBe('FP');
  });

  it('responds to a late acceleration that creates a new physically qualifying encounter', () => {
    const result = evaluateTemporalScenario(fixture('civilian-accelerates-into-conflict'));
    expect(result.independentlyExpectedEncounter).toBe(true);
    expect(result.anyWarningIssued).toBe(true);
    expect(result.firstWarningAtSeconds).toBeGreaterThanOrEqual(5);
  });

  it('tracks real CREATED and CLEARED alert events for a stop-and-go driver', () => {
    const result = evaluateTemporalScenario(fixture('civilian-stop-and-go'));
    expect(result.events.some((event) => event.type === 'CREATED')).toBe(true);
    expect(result.events.some((event) => event.type === 'CLEARED')).toBe(true);
    expect(result.warningCount).toBeGreaterThanOrEqual(1);
  });

  it('records an ETA prediction error when both speeds change after the first warning', () => {
    const result = evaluateTemporalScenario(fixture('both-slow-after-initial-warning'));
    expect(result.independentlyExpectedEncounter).toBe(true);
    expect(result.anyWarningIssued).toBe(true);
    expect(Math.abs(result.etaPredictionErrorSeconds!)).toBeGreaterThan(8);
  });

  it('measures a true crossing beyond the initial prediction horizon', () => {
    const result = evaluateTemporalScenario(fixture('approach-enters-prediction-horizon'));
    expect(result.independentlyExpectedEncounter).toBe(true);
    expect(result.actualAmbulanceCrossingSeconds).toBeGreaterThan(45);
    expect(result.firstWarningAtSeconds).toBeGreaterThan(0);
  });

  it('keeps physically negative stopped-ambulance cases negative', () => {
    const result = evaluateTemporalScenario(fixture('stationary-emergency-vehicle'));
    expect(result.independentlyExpectedEncounter).toBe(false);
    expect(result.anyWarningIssued).toBe(false);
    expect(result.warningLeadSeconds).toBeNull();
  });

  it('does not let changing the connectivity label change the detector prediction', () => {
    const scenario = fixture('early-synchronized-crossing');
    const actual = evaluateTemporalScenario(scenario);
    const inverted = evaluateTemporalScenario({
      ...scenario, id: 'grade-separation-control', physicalConnectivity: 'GRADE_SEPARATED',
    });
    expect(actual.anyWarningIssued).toBe(inverted.anyWarningIssued);
    expect(inverted.independentlyExpectedEncounter).toBe(false);
  });
});

describe('temporal aggregate reporting', () => {
  it('returns empty numeric summaries without inventing zero values', () => {
    expect(summarizeTemporalNumbers([])).toEqual({
      count: 0, min: null, mean: null, median: null, p90: null, max: null,
    });
  });

  it('calculates interpolated median, mean and p90', () => {
    expect(summarizeTemporalNumbers([1, 5, 10, 20])).toMatchObject({
      count: 4, min: 1, mean: 9, median: 7.5, p90: 17, max: 20,
    });
  });

  it('refuses nonfinite temporal observations', () => {
    expect(() => summarizeTemporalNumbers([1, Infinity])).toThrow();
  });

  it('scores all cases and labels the measurements as synthetic', () => {
    const report = evaluateTemporalScenarios();
    expect(report.metrics.samples).toBe(ALL_TEMPORAL_SCENARIOS.length);
    expect(report.actualPositiveCases).toBeGreaterThan(0);
    expect(report.cases.some((value) => value.outcome === 'FN')).toBe(true);
    expect(report.cases.some((value) => value.outcome === 'TP')).toBe(true);
    expect(report.simulation.independentArrivalStepMs).toBe(100);
    expect(report.limitations.some((line) => /not real-world/i.test(line))).toBe(true);
  });

  it('rejects an empty or duplicate fixture set', () => {
    const scene = fixture('early-synchronized-crossing');
    expect(() => evaluateTemporalScenarios([])).toThrow();
    expect(() => evaluateTemporalScenarios([scene, scene])).toThrow(/duplicate/i);
  });

  it('replays one fixture deterministically', () => {
    const scene = fixture('early-synchronized-crossing');
    expect(evaluateTemporalScenario(scene)).toEqual(evaluateTemporalScenario(scene));
  });
});
