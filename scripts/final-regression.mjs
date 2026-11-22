#!/usr/bin/env node
/**
 * Milestone 15C final default-mode regression gate.
 *
 * Default: run tests/builds + offline labeled/temporal/ETA reports and fail if
 * established synthetic fixture outcomes regress. Optional --live reruns the
 * 12-seed, 25-car operator API evaluation; it changes the API's active scene.
 * No backend/API/frontend source is modified by this script.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateOfflineReports, evaluateLiveReport, formatFinalMarkdown,
} from './lib/final-regression.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'demo-reports/final-regression';

export function parseArgs(args) {
  const result = { live: false, manifest: null };
  const seen = new Set();
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return null;
    if (arg === '--live') { if (seen.has('live')) throw new Error('Duplicate --live'); result.live = true; seen.add('live'); continue; }
    const match = /^--manifest=(.+)$/.exec(arg);
    if (match) {
      if (seen.has('manifest')) throw new Error('Duplicate --manifest');
      seen.add('manifest'); result.manifest = match[1]; continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (result.manifest && !result.live) throw new Error('--manifest requires --live');
  return result;
}

export function insideRepo(relativePath) {
  if (!relativePath || isAbsolute(relativePath)) throw new Error('Path must be relative to the EV-RAS repository');
  const full = resolve(ROOT, relativePath);
  const rest = relative(ROOT, full);
  if (!rest || rest.startsWith('..') || isAbsolute(rest)) throw new Error(`Path must remain within EV-RAS: ${relativePath}`);
  return full;
}

function findNodeTests(root = ROOT) {
  const files = [];
  for (const folder of ['scripts', 'scripts/lib']) {
    const full = resolve(root, folder);
    if (!existsSync(full)) continue;
    for (const file of readdirSync(full)) {
      if (file.endsWith('.test.mjs')) files.push(`${folder}/${file}`);
    }
  }
  return files.sort();
}

/** Explicitly set experimental mode OFF in child processes, regardless of the invoking shell. */
export function executionPlan({ live = false, manifest = null }, scriptTests = findNodeTests()) {
  const steps = [
    { name: 'API tests', command: 'pnpm', args: ['test:api'] },
    { name: 'API build', command: 'pnpm', args: ['build:api'] },
    { name: 'API lint', command: 'pnpm', args: ['lint:api'] },
    { name: 'Web tests', command: 'pnpm', args: ['test:web'] },
    { name: 'Web typecheck', command: 'pnpm', args: ['typecheck:web'] },
    { name: 'Web build', command: 'pnpm', args: ['build:web'] },
  ];
  if (scriptTests.length) steps.push({ name: 'Script regression tests', command: 'node', args: ['--test', ...scriptTests] });
  steps.push(
    { name: 'Labeled synthetic evaluation', command: 'node', args: ['scripts/evaluate-labeled-encounters.mjs',
      `--json=${BASE}/labeled.json`, `--md=${BASE}/labeled.md`] },
    { name: 'Temporal synthetic evaluation', command: 'node', args: ['scripts/evaluate-temporal-encounters.mjs',
      `--json=${BASE}/temporal.json`, `--md=${BASE}/temporal.md`] },
    { name: 'Constant vs experimental ETA', command: 'node', args: ['scripts/compare-eta-models.mjs',
      `--json=${BASE}/eta-comparison.json`, `--md=${BASE}/eta-comparison.md`] },
  );
  if (live) {
    const args = ['scripts/evaluate-traffic.mjs', '--start-seed=2026', '--count=12', '--steps=120',
      `--out=${BASE}/traffic.json`, `--md=${BASE}/traffic.md`];
    if (manifest) args.push(`--manifest=${manifest}`);
    steps.push({ name: 'Live operator API 12-seed traffic replay', command: 'node', args });
  }
  return steps;
}

async function runProcess(step) {
  console.log(`\n>>> ${step.name}`);
  await new Promise((pass, fail) => {
    const processChild = spawn(step.command, step.args, {
      cwd: ROOT,
      env: { ...process.env, EVRAS_ADAPTIVE_ETA: '0' },
      stdio: 'inherit',
    });
    processChild.once('error', fail);
    processChild.once('close', (code, signal) => {
      if (code === 0) pass();
      else fail(new Error(`${step.name} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

export async function runPlan(steps, execute = runProcess) {
  for (const step of steps) await execute(step);
}

const loadJson = filename => JSON.parse(readFileSync(insideRepo(filename), 'utf8'));
function persistReports(summary) {
  const jsonPath = insideRepo(`${BASE}/summary.json`);
  const mdPath = insideRepo(`${BASE}/summary.md`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  writeFileSync(mdPath, formatFinalMarkdown(summary), 'utf8');
  return [jsonPath, mdPath];
}

export async function main(argv = process.argv.slice(2), run = runPlan) {
  const opts = parseArgs(argv);
  if (opts === null) {
    console.log('Usage: node scripts/final-regression.mjs [--live] [--manifest=demo-fixtures/traffic-validated.json]');
    console.log('Default: all automated tests and offline synthetic evaluations.');
    console.log('--live: also evaluate 12 OSRM traffic seeds (requires a running API in baseline mode).');
    console.log('--manifest=PATH: optionally verify a saved traffic demo during the live run.');
    return;
  }
  if (opts.manifest && !existsSync(insideRepo(opts.manifest))) throw new Error(`Missing saved demo manifest: ${opts.manifest}`);
  if (opts.live && !process.env.EVRAS_DEMO_OPERATOR_KEY) {
    throw new Error('--live requires EVRAS_DEMO_OPERATOR_KEY; start the API separately with EVRAS_ADAPTIVE_ETA=0');
  }
  const steps = executionPlan(opts);
  await run(steps);
  const offline = evaluateOfflineReports({
    labeled: loadJson(`${BASE}/labeled.json`),
    temporal: loadJson(`${BASE}/temporal.json`),
    comparison: loadJson(`${BASE}/eta-comparison.json`),
  });
  const live = opts.live ? evaluateLiveReport(loadJson(`${BASE}/traffic.json`)) : null;
  const passed = offline.passed && (live?.passed ?? true);
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    passed,
    evaluationType: 'SYNTHETIC_REGRESSION_NOT_REAL_WORLD_SAFETY',
    offline,
    live,
    checksExecuted: steps.map(({ name }) => name),
  };
  const output = persistReports(summary);
  console.log(`\nFINAL REGRESSION: ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`Findings: ${offline.findings.filter(f => f.pass).length}/${offline.findings.length} offline passed`);
  if (opts.live) console.log(`Live gate: ${live.passed ? 'PASS' : 'FAIL'}`);
  for (const finding of [...offline.findings, ...(live?.findings ?? [])].filter(f => !f.pass)) {
    console.error(`FAIL: ${finding.description}`);
  }
  console.log(`Reports: ${output.join(', ')}`);
  console.log('All accuracy figures here concern synthetic fixtures, not real-world road safety.');
  if (!passed) throw new Error('Regression gate failed; do not commit or deploy until reviewed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Final regression failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
}
