import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { formatTemporalMarkdown, parseArgs, main } from './evaluate-temporal-encounters.mjs';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'evaluate-temporal-encounters.mjs');

test('CLI usage does not need a build or backend', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node scripts\/evaluate-temporal-encounters\.mjs/);
});

test('invalid arguments fail with a useful error', () => {
  const result = spawnSync(process.execPath, [script, '--count=100'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown CLI option/);
});

test('duplicate output options fail before any work starts', () => {
  assert.throws(() => parseArgs(['--json=a.json', '--json=b.json']), /Duplicate/);
});

test('output paths cannot leave the repository', async () => {
  await assert.rejects(main(['--json=../outside.json']), /project root/);
  await assert.rejects(main(['--md=/tmp/not-in-repo.md']), /project root/);
});

test('identical JSON and Markdown destination is rejected', async () => {
  await assert.rejects(main(['--json=demo-reports/same.txt', '--md=demo-reports/same.txt']), /distinct/);
});

test('formatter labels lead, error, and accuracy figures as synthetic', () => {
  const report = {
    metrics: { samples: 2, truePositive: 1, falsePositive: 0, trueNegative: 0, falseNegative: 1,
      precision: 1, recall: 0.5, f1: 2 / 3 },
    simulation: { detectorStepMs: 1000, independentArrivalStepMs: 100,
      conflictWindowSeconds: 5, lateThresholdSeconds: 10 },
    lateTruePositiveWarnings: 1,
    warningLeadSeconds: { count: 1, min: 3, mean: 3, median: 3, p90: 3, max: 3 },
    absoluteEtaPredictionErrorSeconds: { count: 1, min: 1, mean: 1, median: 1, p90: 1, max: 1 },
    cases: [
      { id: 'late', independentlyExpectedEncounter: true, anyWarningIssued: true,
        outcome: 'TP', actualAmbulanceCrossingSeconds: 4, actualCivilianCrossingSeconds: 4,
        firstWarningAtSeconds: 1, warningLeadSeconds: 3, etaPredictionErrorSeconds: 1,
        lateWarning: true, warningCount: 1, clearedCount: 1, explanation: 'Late warning' },
    ],
    limitations: ['No road safety effectiveness can be inferred.'],
  };
  const md = formatTemporalMarkdown(report);
  assert.match(md, /All results are from hand-authored synthetic road scenes/);
  assert.match(md, /Warning lead/);
  assert.match(md, /ETA error/);
  assert.match(md, /No road safety effectiveness/);
  assert.match(md, /NOT claims of real-world accuracy/);
});
