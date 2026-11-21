#!/usr/bin/env node
/**
 * EV-RAS 11B: discover, verify, and arm evidence-backed 25-car demo scenarios.
 * Reads genuine responses from the existing operator API; never synthesizes
 * events or promotes a run without a CREATED -> CLEARED warning lifecycle.
 *
 * Discover: node scripts/validate-traffic-demo.mjs --discover --count=12 --steps=120
 * Verify:   node scripts/validate-traffic-demo.mjs --verify=demo-fixtures/traffic-validated.json
 * Arm:      node scripts/validate-traffic-demo.mjs --arm=demo-fixtures/traffic-validated.json
 * Inspect:  node scripts/validate-traffic-demo.mjs --inspect --seed=2026 --steps=90
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  validSeed,
  validateInitializedScene,
  routeFingerprint,
  createAudit,
  scoreAudit,
  assertValidManifest,
  compareAudits,
} from './lib/traffic-demo-audit.mjs';

function usage() {
  console.error('Usage: --discover [--start-seed=2026 --count=12 --steps=120 --out=demo-fixtures/traffic-validated.json]');
  console.error('       --inspect --seed=2026 [--steps=90]');
  console.error('       --verify=PATH  or  --arm=PATH');
  process.exit(2);
}

function parse(argv) {
  const options = {
    mode: 'discover',
    seed: 2026,
    count: 12,
    steps: 120,
    out: 'demo-fixtures/traffic-validated.json',
    file: undefined,
  };
  let modeSupplied = false;
  for (const arg of argv) {
    if (arg === '--discover' || arg === '--inspect' || arg.startsWith('--verify=') || arg.startsWith('--arm=')) {
      if (modeSupplied) usage();
      modeSupplied = true;
      if (arg === '--discover') options.mode = 'discover';
      else if (arg === '--inspect') options.mode = 'inspect';
      else {
        options.mode = arg.startsWith('--verify=') ? 'verify' : 'arm';
        options.file = arg.slice(options.mode === 'verify' ? 9 : 6);
        if (!options.file) usage();
      }
    } else if (arg.startsWith('--start-seed=') || arg.startsWith('--seed=')) {
      options.seed = Number(arg.slice(arg.indexOf('=') + 1));
    } else if (arg.startsWith('--count=')) {
      options.count = Number(arg.slice(8));
    } else if (arg.startsWith('--steps=')) {
      options.steps = Number(arg.slice(8));
    } else if (arg.startsWith('--out=')) {
      options.out = arg.slice(6);
    } else usage();
  }
  if (!validSeed(options.seed) || !Number.isSafeInteger(options.count) ||
      options.count < 1 || options.count > 64 ||
      options.seed + options.count - 1 > 0xffffffff ||
      !Number.isSafeInteger(options.steps) || options.steps < 1 || options.steps > 240 ||
      !options.out) usage();
  return options;
}

const options = parse(process.argv.slice(2));
const key = process.env.EVRAS_DEMO_OPERATOR_KEY;
const rawBaseUrl = process.env.EVRAS_API_URL ?? 'http://localhost:3000';
if (!key) {
  console.error('Missing EVRAS_DEMO_OPERATOR_KEY. Do not commit this credential.');
  process.exit(2);
}
let baseUrl;
try {
  baseUrl = new URL(rawBaseUrl);
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('Unsupported protocol');
} catch {
  console.error('Invalid EVRAS_API_URL');
  process.exit(2);
}

async function api(path, method = 'GET', body) {
  const timeout = path === '/demo/traffic' ? 70_000 : 15_000;
  const response = await fetch(new URL(path, baseUrl), {
    method,
    signal: AbortSignal.timeout(timeout),
    headers: {
      'x-demo-operator-key': key,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`${method} ${path}: non-JSON response (HTTP ${response.status})`); }
  if (!response.ok) {
    throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function saveJSON(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(obj, null, 2)}\n`, { encoding: 'utf8' });
}

async function loadManifest(path) {
  return assertValidManifest(JSON.parse(await readFile(path, 'utf8')));
}

async function startTraffic(seed) {
  const payload = await api('/demo/traffic', 'POST', { seed });
  validateInitializedScene(payload, seed);
  return payload;
}

async function reseedTraffic(seed) {
  const payload = await api('/demo/traffic/reseed', 'POST', { seed });
  validateInitializedScene(payload, seed);
  return payload;
}

async function run(seed, steps) {
  const metadata = await api('/demo/routes');
  const hash = routeFingerprint(metadata);
  const auditor = createAudit(seed, steps, hash, metadata.topologyStatus ?? 'UNAVAILABLE');
  for (let i = 0; i < steps; i++) {
    const tick = await api('/demo/advance', 'POST', { deltaMs: 1000 });
    auditor.acceptTick(tick);
  }
  return auditor.finish();
}

function display(runResult) {
  const { seed, validated, totals, completedDrivers, suppressedCandidates,
    supportedCandidates, activeAtEnd, topologyStatus, geometryHash } = runResult;
  console.log(JSON.stringify({ seed, validated, totals, completedDrivers,
    suppressedCandidates, supportedCandidates, activeAtEnd,
    topologyStatus, geometryHash }, null, 2));
}

async function main() {
  if (options.mode === 'arm' || options.mode === 'verify') {
    const saved = await loadManifest(options.file);
    await startTraffic(saved.seed);
    const actualHash = routeFingerprint(await api('/demo/routes'));
    if (actualHash !== saved.geometryHash) {
      throw new Error('Road geometry differs from the validated manifest. Do not claim a verified replay.');
    }
    if (options.mode === 'arm') {
      console.log(`Armed ${saved.seed}: 25 cars + ambulance at t=0; route hash matches manifest.`);
      console.log('Refresh the browser; press Play. Do not click Run 25-car traffic, which loads its default seed.');
      return;
    }
    const actual = await run(saved.seed, saved.steps);
    compareAudits(saved, actual);
    console.log('VERIFIED: saved OSRM route hash and alert lifecycle timeline both match.');
    display(actual);
    return;
  }

  await startTraffic(options.seed);
  if (options.mode === 'inspect') {
    const result = await run(options.seed, options.steps);
    display(result);
    return;
  }

  let best = null;
  const search = [];
  for (let i = 0; i < options.count; i++) {
    const seed = options.seed + i;
    if (i > 0) await reseedTraffic(seed);
    const result = await run(seed, options.steps);
    search.push({ seed, totals: result.totals, completedDrivers: result.completedDrivers,
      suppressedCandidates: result.suppressedCandidates, topologyStatus: result.topologyStatus });
    console.log(`Seed ${seed}: created=${result.totals.CREATED}, cleared=${result.totals.CLEARED}, ` +
      `completedDrivers=${result.completedDrivers.length}`);
    if (result.validated && (!best || scoreAudit(result) > scoreAudit(best))) best = result;
  }

  if (!best) {
    const report = options.out.replace(/\.json$/i, '') + '.search.json';
    await saveJSON(report, {
      status: 'NO_VALIDATED_SCENARIO',
      explanation: 'No driver had both a CREATED and CLEARED topology-filtered alert.',
      seedStart: options.seed, seedCount: options.count, steps: options.steps, search,
    });
    console.log(`No validated seed in this range. Diagnostic report: ${report}`);
    console.log('Try a larger --count or --steps, or revisit OSRM route geometry. No alerts were fabricated.');
    process.exitCode = 1;
    return;
  }

  // Confirm on a fresh, same-geometry reset before calling a seed validated.
  await reseedTraffic(best.seed);
  const repeated = await run(best.seed, best.steps);
  compareAudits(best, repeated);
  await saveJSON(options.out, best);
  console.log(`VALIDATED and independently replayed: ${options.out}`);
  display(best);
  console.log('Use --verify=PATH on future runs, or --arm=PATH to start the frontend demo.');
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
