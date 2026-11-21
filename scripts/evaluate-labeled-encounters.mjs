#!/usr/bin/env node
/**
 * Milestone 13 — local evaluation against hand-labeled SYNTHETIC road cases.
 * Uses the real, compiled EV-RAS detection modules, without starting NestJS,
 * calling OSRM, or modifying the traffic simulation scene.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(args) {
  const options = {
    json: 'demo-reports/labeled-accuracy.json',
    md: 'demo-reports/labeled-accuracy.md',
  };
  const seen = new Set();
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return null;
    const match = /^--(json|md)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(match[1])) throw new Error(`Duplicate argument: --${match[1]}`);
    seen.add(match[1]);
    options[match[1]] = match[2];
  }
  return options;
}

const display = (rate) => rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;

function tableLine(metrics) {
  return `| ${metrics.samples} | ${metrics.truePositive} | ${metrics.falsePositive} | ${metrics.trueNegative} | ${metrics.falseNegative} | ${display(metrics.precision)} | ${display(metrics.recall)} | ${display(metrics.f1)} |`;
}

export function formatMarkdown(report) {
  const lines = [
    '# EV-RAS — Labeled Synthetic Encounter Evaluation',
    '',
    '**Dataset:** manually labeled, synthetic route geometry and node identities. **Not field data.**',
    '**Detector:** EV-RAS production geometry detector with the 11A topology gate.',
    '',
    '## Confusion matrix and metrics',
    '',
    '| Group | Cases | TP | FP | TN | FN | Precision | Recall | F1 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    `| Full labeled fixture | ${tableLine(report.metrics).slice(2)}`,
    `| Complete node evidence | ${tableLine(report.completeEvidenceMetrics).slice(2)}`,
    `| Deliberately missing annotations | ${tableLine(report.missingAnnotationMetrics).slice(2)}`,
    `| Geometric-only baseline (diagnostic) | ${tableLine(report.geometricOnlyMetrics).slice(2)}`,
    '',
    'TP = true positive; FP = false positive; TN = true negative; FN = false negative.',
    'A missing-annotation positive that receives no alert is counted as **FN** by the manual label.',
    '',
    '## Per-scenario results',
    '',
    '| Scenario | Expected warning | Topology-gated warning | Geometry only | Result | Evidence |',
    '|---|---|---|---|---|---|',
  ];
  for (const item of report.cases) {
    lines.push(`| ${item.id} | ${item.expectedAlert ? 'Yes' : 'No'} | ${item.predictedAlert ? 'Yes' : 'No'} | ${item.geometricCandidate ? 'Yes' : 'No'} | ${item.outcome} | ${item.evidence} |`);
  }
  lines.push('', '## Scenario design notes', '');
  for (const item of report.cases) lines.push(`- **${item.id}** (${item.category}): ${item.explanation}`);
  lines.push('', '## Limitations', '');
  for (const item of report.limitations) lines.push(`- ${item}`);
  lines.push('');
  return lines.join('\n');
}

function saveFile(filename, contents) {
  const path = resolve(ROOT, filename);
  // Avoid accidental writes outside the project for relative arguments.
  if (!path.startsWith(`${ROOT}/`)) throw new Error(`Output must be under project root: ${filename}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options === null) {
    console.log('Usage: node scripts/evaluate-labeled-encounters.mjs [--json=demo-reports/labeled-accuracy.json] [--md=demo-reports/labeled-accuracy.md]');
    return;
  }

  const compiled = join(ROOT, 'apps/api/dist/detection/evaluation/accuracy-evaluator.js');
  if (!existsSync(compiled)) {
    throw new Error('Compiled detector not found. Run `pnpm build:api` before this evaluator.');
  }
  const { evaluateLabeledScenarios } = await import(pathToFileURL(compiled).href);
  const report = evaluateLabeledScenarios();
  const jsonPath = saveFile(options.json, `${JSON.stringify(report, null, 2)}\n`);
  const mdPath = saveFile(options.md, formatMarkdown(report));
  const m = report.metrics;
  console.log(`EVALUATION COMPLETE: ${m.samples} manually labeled synthetic cases.`);
  console.log(`Confusion: TP=${m.truePositive} FP=${m.falsePositive} TN=${m.trueNegative} FN=${m.falseNegative}`);
  console.log(`Fixture precision=${display(m.precision)}; recall=${display(m.recall)}; F1=${display(m.f1)}.`);
  console.log(`Missing-annotation subset: ${report.missingAnnotationMetrics.falseNegative} false negatives.`);
  console.log(`Reports: ${jsonPath} and ${mdPath}`);
  console.log('NOT a claim of real-world detector precision, recall, or collision prevention.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Encounter evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
