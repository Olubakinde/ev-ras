import test from 'node:test';
import assert from 'node:assert/strict';
import {
  numericSummary, ambulanceRouteFingerprint, createDetectionEvaluation, summarizeEvaluation, evaluationMarkdown,
} from './detection-evaluation.mjs';

const HASH = 'a'.repeat(64);
const cars = [{ id: 'AMB-001', kind: 'EMERGENCY' },
  ...Array.from({ length: 25 }, (_, i) => ({ id: `CAR-${String(i + 1).padStart(3, '0')}`, kind: 'CIVILIAN' }))];

function event(type, driverId = 'CAR-025', overrides = {}) {
  return { type, alert: { civilianVehicleId: driverId, emergencyVehicleId: 'AMB-001',
    reason: 'CROSSING', emergencyEtaSeconds: 12, civilianEtaSeconds: 13,
    etaDifferenceSeconds: 1, ...overrides } };
}

function tick(second, events = [], suppressed = 0, encounters = 0, alerts) {
  const active = alerts ?? (events.some((e) => e.type === 'CREATED' || e.type === 'UPDATED')
    ? ['CAR-025'] : []);
  return { timeMs: second * 1000, events, suppressedCandidateCount: suppressed,
    encounterCount: encounters, snapshot: { vehicles: cars,
      alerts: active.map((civilianVehicleId) => ({ civilianVehicleId })) } };
}

function run(seed = 2028) {
  const evaluator = createDetectionEvaluation(seed, 4, HASH, 'OSM_NODE_EVIDENCE');
  evaluator.acceptTick(tick(1, [event('CREATED')], 1, 1));
  evaluator.acceptTick(tick(2, [event('UPDATED')], 0, 1));
  evaluator.acceptTick(tick(3, [event('CLEARED')], 0, 0));
  evaluator.acceptTick(tick(4));
  return evaluator.finish();
}

test('numeric summary handles empty observations', () => {
  assert.deepEqual(numericSummary([], 2), { samples: 0, missing: 2, min: null, p10: null,
    median: null, mean: null, p90: null, max: null, below5: 0, below10: 0 });
});

test('numeric summary computes median and mean without rounding sample counts', () => {
  const metric = numericSummary([10, 2, 20, 5]);
  assert.equal(metric.median, 7.5);
  assert.equal(metric.mean, 9.25);
  assert.equal(metric.min, 2);
  assert.equal(metric.max, 20);
  assert.equal(metric.below5, 1);
  assert.equal(metric.below10, 2);
});

test('p90 uses interpolated percentile, not largest sample', () => {
  assert.equal(numericSummary([0, 10, 20]).p90, 18);
});

test('numeric summary rejects negative and nonfinite measurements', () => {
  assert.throws(() => numericSummary([-1]), /nonnegative/);
  assert.throws(() => numericSummary([Infinity]), /nonnegative/);
  assert.throws(() => numericSummary([NaN]), /nonnegative/);
});

test('numeric summary tracks missing without inventing values', () => {
  const metric = numericSummary([8], 3);
  assert.equal(metric.samples, 1);
  assert.equal(metric.missing, 3);
  assert.equal(metric.median, 8);
});

test('alert lifecycle gives predicted ETA at CREATED and observed active duration', () => {
  const result = run();
  assert.equal(result.metrics.createdEpisodes, 1);
  assert.equal(result.metrics.completedEpisodes, 1);
  assert.equal(result.metrics.stillActiveEpisodes, 0);
  assert.equal(result.metrics.predictedEmergencyEtaAtCreationSeconds.median, 12);
  assert.equal(result.metrics.predictedCivilianEtaAtCreationSeconds.median, 13);
  assert.equal(result.metrics.observedAlertActiveDurationSeconds.median, 2);
  assert.equal(result.episodes[0].updateCount, 1);
  assert.equal(result.episodes[0].createdAtSecond, 1);
  assert.equal(result.episodes[0].clearedAtSecond, 3);
});

test('candidate observations preserve counter sums, not unique encounters', () => {
  const result = run();
  assert.equal(result.suppressedCandidateObservations, 1);
  assert.equal(result.supportedCandidateObservations, 2);
});

test('reason category reflects actual emitted events', () => {
  assert.deepEqual(run().metrics.reasons, { CROSSING: 1 });
});

test('multiple cycles for the same driver are not collapsed into one episode', () => {
  const evaluator = createDetectionEvaluation(2028, 4, HASH, 'OSM_NODE_EVIDENCE');
  evaluator.acceptTick(tick(1, [event('CREATED')]));
  evaluator.acceptTick(tick(2, [event('CLEARED')]));
  evaluator.acceptTick(tick(3, [event('CREATED', 'CAR-025', { emergencyEtaSeconds: 3 })]));
  evaluator.acceptTick(tick(4, [event('CLEARED')]));
  const data = evaluator.finish();
  assert.equal(data.metrics.completedEpisodes, 2);
  assert.equal(data.completedDriverCount, 1);
  assert.equal(data.metrics.predictedEmergencyEtaAtCreationSeconds.median, 7.5);
});

test('uncleared warning remains marked active at end', () => {
  const evaluator = createDetectionEvaluation(2028, 2, HASH, 'OSM_NODE_EVIDENCE');
  evaluator.acceptTick(tick(1, [event('CREATED')]));
  evaluator.acceptTick(tick(2, [event('UPDATED')]));
  const result = evaluator.finish();
  assert.equal(result.metrics.completedEpisodes, 0);
  assert.equal(result.metrics.stillActiveEpisodes, 1);
  assert.equal(result.metrics.observedAlertActiveDurationSeconds.samples, 0);
  assert.deepEqual(result.audit.activeAtEnd, ['CAR-025']);
});

test('missing ETA is reported as missing, never zero', () => {
  const evaluator = createDetectionEvaluation(2028, 2, HASH, 'OSM_NODE_EVIDENCE');
  evaluator.acceptTick(tick(1, [event('CREATED', 'CAR-025', {
    emergencyEtaSeconds: undefined, civilianEtaSeconds: null,
  })]));
  evaluator.acceptTick(tick(2, [event('CLEARED')]));
  const result = evaluator.finish();
  assert.equal(result.metrics.predictedEmergencyEtaAtCreationSeconds.samples, 0);
  assert.equal(result.metrics.predictedEmergencyEtaAtCreationSeconds.missing, 1);
  assert.equal(result.episodes[0].predictedEmergencyEtaSeconds, null);
});

test('invalid prediction values fail the evaluation instead of being silently dropped', () => {
  const evaluator = createDetectionEvaluation(2028, 1, HASH, 'OSM_NODE_EVIDENCE');
  assert.throws(() => evaluator.acceptTick(tick(1, [event('CREATED', 'CAR-025', {
    emergencyEtaSeconds: -4,
  })])), /nonnegative/);
});

test('invalid tick timing fails before evidence is recorded', () => {
  const evaluator = createDetectionEvaluation(2028, 2, HASH, 'OSM_NODE_EVIDENCE');
  assert.throws(() => evaluator.acceptTick(tick(2)), /invalid tick/);
});

test('clearing a warning without creation is rejected by 11B audit', () => {
  const evaluator = createDetectionEvaluation(2028, 1, HASH, 'OSM_NODE_EVIDENCE');
  assert.throws(() => evaluator.acceptTick(tick(1, [event('CLEARED')])), /CLEARED without CREATED/);
});

test('incomplete replay cannot be scored', () => {
  const evaluator = createDetectionEvaluation(2028, 2, HASH, 'OSM_NODE_EVIDENCE');
  evaluator.acceptTick(tick(1));
  assert.throws(() => evaluator.finish(), /missing simulation ticks/);
});

test('aggregate counts driver-runs, not unique human drivers', () => {
  const result = summarizeEvaluation([run(2028), run(2029)]);
  assert.equal(result.runs, 2);
  assert.equal(result.civilianDriverRuns, 50);
  assert.equal(result.driverRunsWithAnyWarning, 2);
  assert.equal(result.eventTotals.CREATED, 2);
  assert.equal(result.eventTotals.CLEARED, 2);
  assert.equal(result.observedAlertActiveDurationSeconds.samples, 2);
});

test('aggregate preserves legitimate per-seed scene geometry and topology differences', () => {
  const a = run(2028);
  const b = { ...run(2029), geometryHash: 'b'.repeat(64), topologyStatus: 'UNAVAILABLE' };
  const result = summarizeEvaluation([a, b]);
  assert.equal(result.roadGeometryHash, null);
  assert.equal(result.roadGeometryHashesBySeed.length, 2);
  assert.deepEqual(result.roadGeometryHashesBySeed.map((x) => x.geometryHash),
    ['a'.repeat(64), 'b'.repeat(64)]);
  assert.equal(result.topologyStatus, 'MIXED');
  assert.deepEqual(result.topologyStatusesBySeed.map((x) => x.topologyStatus),
    ['OSM_NODE_EVIDENCE', 'UNAVAILABLE']);
});

test('aggregate rejects changing ambulance baseline', () => {
  const a = { ...run(2028), ambulanceRouteHash: 'a'.repeat(64) };
  const b = { ...run(2029), ambulanceRouteHash: 'b'.repeat(64) };
  assert.throws(() => summarizeEvaluation([a, b]), /ambulance base route changed/);
});

test('ambulance fingerprint is independent of civilian positions and route array order', () => {
  const ambulance = { vehicleId: 'AMB-001', distanceMeters: 100, durationSeconds: 10,
    coordinates: [[-75.75, 39.68], [-75.74, 39.69]] };
  const car = { vehicleId: 'CAR-001', distanceMeters: 90, durationSeconds: 9,
    coordinates: [[-75.73, 39.67], [-75.72, 39.69]] };
  const metadata = { source: 'OSRM', routes: [ambulance, car] };
  const first = ambulanceRouteFingerprint(metadata);
  assert.equal(first, ambulanceRouteFingerprint({ ...metadata, routes: [
    { ...car, coordinates: [[-75.731, 39.67], [-75.72, 39.69]] }, ambulance,
  ] }));
  assert.notEqual(first, ambulanceRouteFingerprint({ ...metadata, routes: [
    { ...ambulance, coordinates: [[-75.75, 39.68], [-75.741, 39.69]] }, car,
  ] }));
});

test('aggregate refuses duplicate seeds', () => {
  assert.throws(() => summarizeEvaluation([run(2028), run(2028)]), /duplicate seed/);
});

test('aggregate refuses empty runs', () => {
  assert.throws(() => summarizeEvaluation([]), /at least one/);
});

test('report does not assert false positives, false negatives, or recall', () => {
  const summary = summarizeEvaluation([run()]);
  assert.equal(summary.realWorldFalsePositives, null);
  assert.equal(summary.realWorldFalseNegatives, null);
  assert.equal(summary.realWorldRecall, null);
  assert.ok(summary.limitations.some((line) => line.includes('ground truth')));
});

test('markdown labels predicted ETAs and candidate observations accurately', () => {
  const runs = [run()];
  const markdown = evaluationMarkdown({ generatedAt: '2026-11-21', summary: summarizeEvaluation(runs), runs });
  assert.match(markdown, /predicted ETAs, not observed real-world lead times/i);
  assert.match(markdown, /candidate \*\*observations\*\*/i);
  assert.match(markdown, /not recall/i);
  assert.match(markdown, /2028/);
  assert.match(markdown, /Route geometry by seed/);
  assert.match(markdown, /starting positions/);
});
