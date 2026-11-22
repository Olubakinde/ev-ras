#!/usr/bin/env node
/**
 * Side-by-side, simulation-only, offline comparison of constant-speed and
 * bounded-trend ETA estimators. The baseline remains the default EV-RAS mode.
 * This reports matched-timestamp ETA errors separately from classification
 * differences so improved ETA statistics cannot hide a missed warning.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(args) {
  const options = { json: 'demo-reports/adaptive-eta-comparison.json', md: 'demo-reports/adaptive-eta-comparison.md' };
  const seen = new Set();
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return null;
    const match = /^--(json|md)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(match[1])) throw new Error(`Duplicate argument: ${match[1]}`);
    seen.add(match[1]);
    options[match[1]] = match[2];
  }
  return options;
}

function outputPath(filename) {
  if (!filename || isAbsolute(filename)) throw new Error('Output paths must be relative');
  const full = resolve(ROOT, filename);
  const rel = relative(ROOT, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Outputs must stay in the repository');
  return full;
}

function summarize(values) {
  if (!values.length) return { count: 0, mean: null, median: null };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  const median = (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
  return { count: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, median };
}

/** Matched observations: same scenario + same simulation second, before passage. */
export function compareEtaCases(baseline, adaptive) {
  if (baseline.length !== adaptive.length) throw new Error('Model runs have different case counts');
  const samples = [];
  const differingWarnings = [];
  for (let i = 0; i < baseline.length; i++) {
    const first = baseline[i];
    const second = adaptive[i];
    if (first.id !== second.id ||
        first.actualAmbulanceCrossingSeconds !== second.actualAmbulanceCrossingSeconds ||
        first.independentlyExpectedEncounter !== second.independentlyExpectedEncounter) {
      throw new Error(`Models disagree on scenario or independent ground truth at ${i}`);
    }
    if (first.anyWarningIssued !== second.anyWarningIssued || first.outcome !== second.outcome) {
      differingWarnings.push({ id: first.id, baseline: first.outcome, adaptive: second.outcome });
    }
    if (first.actualAmbulanceCrossingSeconds === null) continue;
    const eventTimes = new Map(first.events.filter(e => e.type !== 'CLEARED').map(e => [e.timeSeconds, e]));
    for (const event of second.events) {
      if (event.type === 'CLEARED') continue;
      const other = eventTimes.get(event.timeSeconds);
      if (!other || event.timeSeconds > first.actualAmbulanceCrossingSeconds) continue;
      samples.push({
        id: first.id, timeSeconds: event.timeSeconds,
        baselineErrorSeconds: Math.abs(event.timeSeconds + other.emergencyEtaSeconds - first.actualAmbulanceCrossingSeconds),
        adaptiveErrorSeconds: Math.abs(event.timeSeconds + event.emergencyEtaSeconds - first.actualAmbulanceCrossingSeconds),
      });
    }
  }
  return {
    comparisonKind: 'MATCHED_SIMULATED_ALERT_UPDATE_TIMES',
    pairedSamples: samples,
    baselineAbsoluteErrorSeconds: summarize(samples.map(x => x.baselineErrorSeconds)),
    adaptiveAbsoluteErrorSeconds: summarize(samples.map(x => x.adaptiveErrorSeconds)),
    classificationChanges: differingWarnings,
    caveats: [
      'All fixtures are hand-authored synthetic scenes; this is NOT measured road performance.',
      'Matched-update errors exclude times when one model produced no warning; classificationChanges must be reviewed separately.',
      'An acceleration forecast does not anticipate arbitrary future stops or speed changes.',
      'Default detector behavior remains constant-speed unless EVRAS_ADAPTIVE_ETA=1 is enabled.',
    ],
  };
}

const fmt = n => n === null ? 'n/a' : n.toFixed(3);
export function formatMarkdown(result) {
  const lines = [
    '# EV-RAS — Experimental Adaptive ETA Comparison', '',
    '**Synthetic evaluation only. No real-world accuracy or safety claim.**', '',
    'Both estimators are evaluated on the same manually authored driving trajectories.',
    'The table compares absolute ambulance ETA error only at matching warning update timestamps.', '',
    '| Metric | Constant speed | Adaptive trend |', '|---|---:|---:|',
    `| Matched ETA observations | ${result.baselineAbsoluteErrorSeconds.count} | ${result.adaptiveAbsoluteErrorSeconds.count} |`,
    `| Mean absolute error (s) | ${fmt(result.baselineAbsoluteErrorSeconds.mean)} | ${fmt(result.adaptiveAbsoluteErrorSeconds.mean)} |`,
    `| Median absolute error (s) | ${fmt(result.baselineAbsoluteErrorSeconds.median)} | ${fmt(result.adaptiveAbsoluteErrorSeconds.median)} |`,
    '', `Warning classification changes: ${result.classificationChanges.length}`, '',
  ];
  for (const change of result.classificationChanges) {
    lines.push(`- ${change.id}: constant speed ${change.baseline}; adaptive ${change.adaptive}`);
  }
  lines.push('', '## Limitations', '');
  for (const caveat of result.caveats) lines.push(`- ${caveat}`);
  lines.push('');
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2)) {
  const opts = parseArgs(args);
  if (opts === null) {
    console.log('Usage: node scripts/compare-eta-models.mjs [--json=demo-reports/adaptive-eta-comparison.json] [--md=demo-reports/adaptive-eta-comparison.md]');
    return;
  }
  const jsonPath = outputPath(opts.json);
  const mdPath = outputPath(opts.md);
  if (jsonPath === mdPath) throw new Error('JSON and Markdown outputs must be different');
  const compiled = join(ROOT, 'apps/api/dist/detection/evaluation/temporal-evaluator.js');
  const fixtureCompiled = join(ROOT, 'apps/api/dist/detection/evaluation/temporal-scenarios.js');
  if (!existsSync(compiled) || !existsSync(fixtureCompiled)) {
    throw new Error('Compiled temporal evaluation missing: run pnpm build:api');
  }
  const { evaluateTemporalScenarios } = await import(pathToFileURL(compiled).href);
  const { ALL_TEMPORAL_SCENARIOS } = await import(pathToFileURL(fixtureCompiled).href);
  // Two extra speed-ramp fixtures; preserve the original 12-scenario benchmark.
  const source = ALL_TEMPORAL_SCENARIOS.find(s => s.id === 'early-synchronized-crossing');
  if (!source) throw new Error('Expected Milestone 14 baseline fixture not found');
  const scenes = [
    ...ALL_TEMPORAL_SCENARIOS,
    { ...source, id: '15b-gradual-ambulance-braking',
      explanation: 'Ambulance speed decreases in measured one-second steps.',
      ambulanceSpeedChanges: [
        { atSeconds: 3, speedMps: 14 }, { atSeconds: 4, speedMps: 13 },
        { atSeconds: 5, speedMps: 12 }, { atSeconds: 6, speedMps: 11 },
        { atSeconds: 7, speedMps: 10 }, { atSeconds: 8, speedMps: 9 },
      ],
    },
    { ...source, id: '15b-gradual-ambulance-acceleration',
      explanation: 'Ambulance speed increases in measured one-second steps.',
      ambulance: { ...source.ambulance, speedMps: 8 },
      ambulanceSpeedChanges: [
        { atSeconds: 3, speedMps: 9 }, { atSeconds: 4, speedMps: 10 },
        { atSeconds: 5, speedMps: 11 }, { atSeconds: 6, speedMps: 12 },
        { atSeconds: 7, speedMps: 13 }, { atSeconds: 8, speedMps: 14 },
      ],
    },
  ];
  const baseline = evaluateTemporalScenarios(scenes, 'BASELINE');
  const adaptive = evaluateTemporalScenarios(scenes, 'ADAPTIVE');
  const comparison = compareEtaCases(baseline.cases, adaptive.cases);
  const result = { ...comparison, scenarios: scenes.length,
    baselineConfusion: baseline.metrics, adaptiveConfusion: adaptive.metrics };
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(result, null, 2) + '\n');
  writeFileSync(mdPath, formatMarkdown(result));
  console.log(`EVALUATION: ${scenes.length} synthetic scenes, ${comparison.pairedSamples.length} paired ETA observations.`);
  console.log(`Mean absolute ETA error at matched updates: baseline=${fmt(comparison.baselineAbsoluteErrorSeconds.mean)}s; adaptive=${fmt(comparison.adaptiveAbsoluteErrorSeconds.mean)}s.`);
  console.log(`Warning classification changes: ${comparison.classificationChanges.length}; inspect these before considering rollout.`);
  console.log(`Reports: ${jsonPath} and ${mdPath}`);
  console.log('No real-world performance claim. Experimental mode is OFF by default.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`ETA comparison failed: ${e.message}`); process.exitCode = 1; });
}
