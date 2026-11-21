import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formatMarkdown } from './evaluate-labeled-encounters.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'evaluate-labeled-encounters.mjs');

test('usage is available without starting the backend or building TS', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('invalid CLI options fail with an actionable error', () => {
  const result = spawnSync(process.execPath, [script, '--bad=1'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument/);
});

test('Markdown identifies synthetic metrics rather than field accuracy', () => {
  const fake = {
    metrics: { samples: 2, truePositive: 1, falsePositive: 0, trueNegative: 1, falseNegative: 0, precision: 1, recall: 1, f1: 1 },
    completeEvidenceMetrics: { samples: 2, truePositive: 1, falsePositive: 0, trueNegative: 1, falseNegative: 0, precision: 1, recall: 1, f1: 1 },
    missingAnnotationMetrics: { samples: 0, truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, precision: null, recall: null, f1: null },
    geometricOnlyMetrics: { samples: 2, truePositive: 1, falsePositive: 0, trueNegative: 1, falseNegative: 0, precision: 1, recall: 1, f1: 1 },
    cases: [
      { id: 'case-a', expectedAlert: true, predictedAlert: true, geometricCandidate: true, outcome: 'TP', evidence: 'COMPLETE', category: 'AT_GRADE_CROSSING', explanation: 'A fictional synthetic crossing' },
    ],
    limitations: ['Not field data'],
  };
  const output = formatMarkdown(fake);
  assert.match(output, /manually labeled, synthetic/);
  assert.match(output, /Not field data/);
  assert.match(output, /case-a/);
  assert.match(output, /\| Full labeled fixture \| 2 \| 1 \| 0 \| 1 \| 0 \| 100\.0%/);
});
