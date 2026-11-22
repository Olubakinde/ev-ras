import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseArgs, compareEtaCases, formatMarkdown } from './compare-eta-models.mjs';

const make = (eta, outcome = 'TP') => ({
  id: 'crossing', actualAmbulanceCrossingSeconds: 20, independentlyExpectedEncounter: true,
  anyWarningIssued: outcome === 'TP', outcome,
  events: outcome === 'TP' ? [
    { type: 'CREATED', timeSeconds: 10, emergencyEtaSeconds: eta },
    { type: 'UPDATED', timeSeconds: 11, emergencyEtaSeconds: eta - 1 },
    { type: 'CLEARED', timeSeconds: 19, emergencyEtaSeconds: 0 },
  ] : [],
});
test('accepts default CLI arguments', () => {
  assert.match(parseArgs([]).json, /comparison/);
});
test('rejects unknown flags and duplicates', () => {
  assert.throws(() => parseArgs(['--anything=1']), /Unknown/);
  assert.throws(() => parseArgs(['--md=a', '--md=b']), /Duplicate/);
});
test('compares errors at common alert times only', () => {
  const result = compareEtaCases([make(12)], [make(10)]);
  assert.equal(result.baselineAbsoluteErrorSeconds.mean, 2);
  assert.equal(result.adaptiveAbsoluteErrorSeconds.mean, 0);
  assert.equal(result.pairedSamples.length, 2);
});
test('preserves model classification disagreement', () => {
  const result = compareEtaCases([make(10)], [make(10, 'FN')]);
  assert.equal(result.classificationChanges.length, 1);
  assert.equal(result.pairedSamples.length, 0);
});
test('rejects mismatched scenario ground truth', () => {
  assert.throws(() => compareEtaCases([make(10)], [{ ...make(10), actualAmbulanceCrossingSeconds: 21 }]), /ground truth/);
});
test('report retains synthetic limitations', () => {
  const report = formatMarkdown(compareEtaCases([make(12)], [make(10)]));
  assert.match(report, /synthetic/i);
  assert.match(report, /classification/i);
  assert.match(report, /Matched ETA observations/);
});
