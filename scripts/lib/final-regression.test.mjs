import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_BASELINE, evaluateOfflineReports, evaluateLiveReport, formatFinalMarkdown,
} from './final-regression.mjs';

const metrics = (truePositive, falsePositive, trueNegative, falseNegative) => ({
  samples: truePositive + falsePositive + trueNegative + falseNegative,
  truePositive, falsePositive, trueNegative, falseNegative,
});

const labeledCases = () => [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `positive-${i}`, outcome: 'TP', expectedAlert: true, predictedAlert: true })),
  { id: 'missing-evidence-a', outcome: 'FN', expectedAlert: true, predictedAlert: false },
  { id: 'missing-evidence-b', outcome: 'FN', expectedAlert: true, predictedAlert: false },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `negative-${i}`, outcome: 'TN', expectedAlert: false, predictedAlert: false })),
];
const temporalCases = () => Object.entries(KNOWN_BASELINE.temporalCaseOutcomes).map(([id, outcome]) => ({
  id, outcome,
  independentlyExpectedEncounter: outcome === 'TP' || outcome === 'FN',
  anyWarningIssued: outcome === 'TP' || outcome === 'FP',
  warningLeadSeconds: outcome === 'TP' ? 17.11 : null,
}));
function fixture() {
  return {
    labeled: {
      evaluationKind: 'HAND_LABELED_SYNTHETIC_ROAD_CASES', detector: 'TOPOLOGY_GATED_BASELINE',
      metrics: metrics(6, 0, 9, 2), missingAnnotationMetrics: metrics(0, 0, 0, 2), cases: labeledCases(),
    },
    temporal: {
      metrics: metrics(7, 1, 3, 1), cases: temporalCases(),
      simulation: { detectorStepMs: 1000, independentArrivalStepMs: 100 },
      lateTruePositiveWarnings: 1, warningLeadSeconds: { median: 17.11 },
      absoluteEtaPredictionErrorSeconds: { p90: 4.59 },
    },
    comparison: {
      comparisonKind: 'MATCHED_SIMULATED_ALERT_UPDATE_TIMES', scenarios: 14,
      pairedSamples: Array.from({ length: 151 }, (_, i) => ({ timeSeconds: i })),
      classificationChanges: [],
      baselineAbsoluteErrorSeconds: { mean: 0.509 },
      adaptiveAbsoluteErrorSeconds: { mean: 0.525 },
    },
  };
}
function liveFixture() {
  return {
    origin: 'EV-RAS OPERATOR API / SYNTHETIC TRAFFIC',
    summary: {
      runs: 12, civilianDriversPerRun: 25, civilianDriverRuns: 300,
      eventTotals: { CREATED: 117, UPDATED: 400, CLEARED: 117 },
      stillActiveEpisodes: 0, ambulanceRouteHash: 'a'.repeat(64),
      seeds: Array.from({ length: 12 }, (_, i) => 2026 + i),
      supportedCandidateObservations: 1106, suppressedCandidateObservations: 67,
      predictedEmergencyEtaAtCreationSeconds: { median: 10.951 },
    },
    runs: Array.from({ length: 12 }, (_, i) => ({
      audit: { totals: { CREATED: i === 0 ? 18 : 9 } },
    })),
  };
}

// The fake live fixture gives 18 + (11 x 9) = 117.
test('known frozen numbers match the verified milestone reports', () => {
  assert.deepEqual(KNOWN_BASELINE.labeled, metrics(6, 0, 9, 2));
  assert.deepEqual(KNOWN_BASELINE.temporal, metrics(7, 1, 3, 1));
});
test('passes the documented default detector results', () => {
  const result = evaluateOfflineReports(fixture());
  assert.equal(result.passed, true);
  assert.equal(result.findings.filter(f => !f.pass).length, 0);
});
test('detects an extra false positive rather than smoothing it away', () => {
  const data = fixture();
  data.labeled.cases[0].outcome = 'FP';
  data.labeled.metrics = metrics(5, 1, 9, 2);
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('detects an extra temporal missed encounter', () => {
  const data = fixture();
  data.temporal.cases[0].outcome = 'FN';
  data.temporal.metrics = metrics(6, 1, 3, 2);
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('detects inflated confusion metrics inconsistent with actual case records', () => {
  const data = fixture();
  data.temporal.metrics = metrics(8, 0, 3, 1);
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('rejects duplicate scenario IDs instead of treating them as independent samples', () => {
  const data = fixture();
  data.labeled.cases[1].id = data.labeled.cases[0].id;
  assert.throws(() => evaluateOfflineReports(data), /duplicate/);
});
test('rejects missing overpass guard', () => {
  const data = fixture();
  data.temporal.cases.find(x => x.id === 'overpass-no-road-connection').anyWarningIssued = true;
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('does not relabel topology abstention as true negative', () => {
  const data = fixture();
  data.temporal.cases.find(x => x.id === 'at-grade-missing-node-evidence').outcome = 'TN';
  data.temporal.metrics = metrics(7, 1, 4, 0);
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('per-case temporal baseline detects a swapped positive and negative verdict', () => {
  const data = fixture();
  const cases = data.temporal.cases;
  const first = cases.find(item => item.id === 'early-synchronized-crossing');
  const overpass = cases.find(item => item.id === 'overpass-no-road-connection');
  // Maintain the same overall confusion counts while changing individual cases.
  first.outcome = 'TN'; first.independentlyExpectedEncounter = false; first.anyWarningIssued = false;
  overpass.outcome = 'TP'; overpass.independentlyExpectedEncounter = true; overpass.anyWarningIssued = true; overpass.warningLeadSeconds = 10;
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('per-case labels cannot be quietly changed to agree with detector', () => {
  const data = fixture();
  const item = data.labeled.cases[0];
  item.expectedAlert = false;
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('detects additional late warnings', () => {
  const data = fixture(); data.temporal.lateTruePositiveWarnings = 2;
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('detects regression in baseline ETA mean', () => {
  const data = fixture(); data.comparison.baselineAbsoluteErrorSeconds.mean = 0.9;
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('does not claim changing classifications are harmless', () => {
  const data = fixture(); data.comparison.classificationChanges.push({ id: 'example' });
  assert.equal(evaluateOfflineReports(data).passed, false);
});
test('rejects missing or nonfinite ETA measurements', () => {
  const data = fixture(); data.comparison.baselineAbsoluteErrorSeconds.mean = NaN;
  assert.throws(() => evaluateOfflineReports(data), /finite/);
});
test('accepts a consistent 12-seed synthetic operator replay', () => {
  assert.equal(evaluateLiveReport(liveFixture()).passed, true);
});
test('detects missing alerts or incomplete lifecycles in live run', () => {
  const data = liveFixture(); data.summary.eventTotals.CLEARED = 116;
  assert.equal(evaluateLiveReport(data).passed, false);
});
test('detects missing vehicles and per-seed count disagreements', () => {
  const data = liveFixture(); data.summary.civilianDriversPerRun = 24;
  data.runs[0].audit.totals.CREATED = 19;
  assert.equal(evaluateLiveReport(data).passed, false);
});
test('Markdown reports experimental trade-offs and explicit safety limitations', () => {
  const result = evaluateOfflineReports(fixture());
  const markdown = formatFinalMarkdown({ passed: true, generatedAt: '2026-11-22', offline: result, live: null });
  assert.match(markdown, /NOT a road-use authorization/);
  assert.match(markdown, /missing OSM/i);
  assert.match(markdown, /constant speed/i);
  assert.match(markdown, /not proof/i);
});
