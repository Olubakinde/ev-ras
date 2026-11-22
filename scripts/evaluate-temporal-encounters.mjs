#!/usr/bin/env node
/**
 * Offline, manually specified SYNTHETIC temporal scenario evaluation.
 * Loads the genuine compiled EV-RAS detection/simulation modules. Does not
 * contact OSRM, require a running server, or change the UI or live demo.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_JSON = 'demo-reports/temporal-evaluation.json';
const DEFAULT_MD = 'demo-reports/temporal-evaluation.md';

export function parseArgs(args) {
  const options = { json: DEFAULT_JSON, md: DEFAULT_MD };
  const seen = new Set();
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return null;
    const match = /^--(json|md)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Unknown CLI option: ${arg}`);
    if (seen.has(match[1])) throw new Error(`Duplicate CLI option: --${match[1]}`);
    seen.add(match[1]);
    options[match[1]] = match[2];
  }
  return options;
}

function safeFilePath(relativeFilename) {
  if (!relativeFilename || isAbsolute(relativeFilename)) {
    throw new Error('Output paths must be relative to the project root');
  }
  const resolved = resolve(ROOT, relativeFilename);
  const remaining = relative(ROOT, resolved);
  if (!remaining || remaining.startsWith('..') || isAbsolute(remaining)) {
    throw new Error(`Output must remain under the project root: ${relativeFilename}`);
  }
  return resolved;
}

const number = (value) => value === null || value === undefined ? 'n/a' : Number(value).toFixed(2);
const percentage = (value) => value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;

export function formatTemporalMarkdown(report) {
  const m = report.metrics;
  const lines = [
    '# EV-RAS — Temporal Warning Evaluation',
    '',
    '**All results are from hand-authored synthetic road scenes. Not field measurements.**',
    '',
    '## Method',
    '',
    `- Detector evaluated every ${report.simulation.detectorStepMs} ms using actual EV-RAS domain logic and topology gating.`,
    `- Simulated vehicle crossings independently sampled every ${report.simulation.independentArrivalStepMs} ms and interpolated.`,
    `- Physical test label: manually designated at-grade connection and arrival difference ≤ ${report.simulation.conflictWindowSeconds} seconds.`,
    `- Benchmark late-warning threshold: less than ${report.simulation.lateThresholdSeconds} seconds before ambulance passage. This is not a safety standard.`,
    '',
    '## Classification and timing',
    '',
    '| Cases | TP | FP | TN | FN | Precision | Recall | F1 | Late TP warnings |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    `| ${m.samples} | ${m.truePositive} | ${m.falsePositive} | ${m.trueNegative} | ${m.falseNegative} | ${percentage(m.precision)} | ${percentage(m.recall)} | ${percentage(m.f1)} | ${report.lateTruePositiveWarnings} |`,
    '',
    '| Metric | Count | Min (s) | Mean (s) | Median (s) | p90 (s) | Max (s) |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [label, stats] of [
    ['Warning lead (true positives)', report.warningLeadSeconds],
    ['Absolute first-warning ETA error (true positives)', report.absoluteEtaPredictionErrorSeconds],
  ]) {
    lines.push(`| ${label} | ${stats.count} | ${number(stats.min)} | ${number(stats.mean)} | ${number(stats.median)} | ${number(stats.p90)} | ${number(stats.max)} |`);
  }
  lines.push('', '## Independent crossing and warning results', '',
    '| Case | Physical outcome | Detector warned | TP/FP/TN/FN | Ambulance crossing (s) | Car crossing (s) | First warning (s) | Warning lead (s) | ETA error (s) | Late? | Created/Cleared |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---|---:|');
  for (const item of report.cases) {
    lines.push(`| ${item.id} | ${item.independentlyExpectedEncounter ? 'Conflict' : 'No conflict'} | ${item.anyWarningIssued ? 'Yes' : 'No'} | ${item.outcome} | ${number(item.actualAmbulanceCrossingSeconds)} | ${number(item.actualCivilianCrossingSeconds)} | ${number(item.firstWarningAtSeconds)} | ${number(item.warningLeadSeconds)} | ${number(item.etaPredictionErrorSeconds)} | ${item.lateWarning === null ? 'n/a' : item.lateWarning ? 'Yes' : 'No'} | ${item.warningCount}/${item.clearedCount} |`);
  }
  lines.push('', '## Scenario rationale', '');
  for (const item of report.cases) lines.push(`- **${item.id}:** ${item.explanation}`);
  lines.push('', '## Interpretation and limitations', '');
  for (const item of report.limitations) lines.push(`- ${item}`);
  lines.push('', 'These figures are NOT claims of real-world accuracy, road safety effectiveness, or collision prevention.', '');
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options === null) {
    console.log('Usage: node scripts/evaluate-temporal-encounters.mjs [--json=demo-reports/temporal-evaluation.json] [--md=demo-reports/temporal-evaluation.md]');
    return;
  }
  const jsonPath = safeFilePath(options.json);
  const mdPath = safeFilePath(options.md);
  if (jsonPath === mdPath) throw new Error('JSON and Markdown outputs must use distinct paths');
  const compiled = join(ROOT, 'apps/api/dist/detection/evaluation/temporal-evaluator.js');
  if (!existsSync(compiled)) throw new Error('Compiled temporal evaluator not found. Run `pnpm build:api` first.');
  const { evaluateTemporalScenarios } = await import(pathToFileURL(compiled).href);
  const report = evaluateTemporalScenarios();
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, formatTemporalMarkdown(report));
  const m = report.metrics;
  console.log(`TEMPORAL EVALUATION: ${m.samples} synthetic time-series scenarios.`);
  console.log(`TP=${m.truePositive}, FP=${m.falsePositive}, TN=${m.trueNegative}, FN=${m.falseNegative}; fixture recall=${percentage(m.recall)}.`);
  console.log(`Late true-positive warnings (<${report.simulation.lateThresholdSeconds}s benchmark): ${report.lateTruePositiveWarnings}`);
  console.log(`Warning lead time: median=${number(report.warningLeadSeconds.median)}s; p90=${number(report.warningLeadSeconds.p90)}s.`);
  console.log(`Absolute ETA prediction error: median=${number(report.absoluteEtaPredictionErrorSeconds.median)}s; p90=${number(report.absoluteEtaPredictionErrorSeconds.p90)}s.`);
  console.log(`Reports: ${jsonPath} and ${mdPath}`);
  console.log('Synthetic simulation evaluation only; real-world accuracy and safety effectiveness remain unknown.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Temporal evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
