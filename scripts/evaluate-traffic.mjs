#!/usr/bin/env node
/**
 * EV-RAS Milestone 12B — quantitative evaluation of genuine simulated events.
 *
 * Requires the 11B API: POST /demo/traffic, POST /demo/traffic/reseed,
 * GET /demo/routes, POST /demo/advance.
 * Does not alter detection, auth, or frontend code.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  routeFingerprint, validateInitializedScene, assertValidManifest,
  compareAudits, validSeed,
} from './lib/traffic-demo-audit.mjs';
import {
  ambulanceRouteFingerprint, createDetectionEvaluation, summarizeEvaluation, evaluationMarkdown,
} from './lib/detection-evaluation.mjs';

function help(message) {
  if (message) console.error(message);
  console.error('Usage: node scripts/evaluate-traffic.mjs [--start-seed=2026] [--count=12] [--steps=120]');
  console.error('       [--out=demo-reports/traffic-evaluation.json] [--md=demo-reports/traffic-evaluation.md]');
  console.error('       [--manifest=demo-fixtures/traffic-validated.json]');
  process.exit(2);
}

export function parseArguments(argv) {
  const options = {
    seed: 2026, count: 12, steps: 120,
    out: 'demo-reports/traffic-evaluation.json',
    md: 'demo-reports/traffic-evaluation.md',
    manifest: undefined,
  };
  const seen = new Set();
  for (const argument of argv) {
    const index = argument.indexOf('=');
    if (!argument.startsWith('--') || index < 3) throw new Error(`Unexpected argument: ${argument}`);
    const name = argument.slice(2, index);
    const value = argument.slice(index + 1);
    const field = ({ 'start-seed': 'seed', count: 'count', steps: 'steps', out: 'out', md: 'md', manifest: 'manifest' })[name];
    if (!field || seen.has(field) || !value) throw new Error(`Invalid or duplicate option: --${name}`);
    seen.add(field);
    options[field] = ['seed', 'count', 'steps'].includes(field) ? Number(value) : value;
  }
  if (!validSeed(options.seed) || !Number.isSafeInteger(options.count) || options.count < 1 || options.count > 64 ||
      options.seed + options.count - 1 > 0xffffffff || !Number.isSafeInteger(options.steps) ||
      options.steps < 1 || options.steps > 240 || !options.out || !options.md || options.out === options.md) {
    throw new Error('Invalid seed/count/steps/output option');
  }
  return options;
}

export async function apiRequest(baseUrl, key, path, method = 'GET', body) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    signal: AbortSignal.timeout(path === '/demo/traffic' ? 70_000 : 15_000),
    headers: {
      'x-demo-operator-key': key,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`${method} ${path}: non-JSON response, HTTP ${response.status}`); }
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function persist(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}

export async function evaluate(options, { baseUrl, key, onProgress = () => {} }) {
  if (!key) throw new Error('Missing EVRAS_DEMO_OPERATOR_KEY; do not commit credentials.');
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('EVRAS_API_URL must use HTTP(S)');

  let manifest = null;
  if (options.manifest) {
    manifest = assertValidManifest(JSON.parse(await readFile(options.manifest, 'utf8')));
    if (manifest.steps !== options.steps || manifest.seed < options.seed ||
        manifest.seed >= options.seed + options.count) {
      throw new Error('The validated manifest seed and step count must be included in this evaluation');
    }
  }

  const api = (path, method = 'GET', body) => apiRequest(url, key, path, method, body);
  const runs = [];
  let expectedAmbulanceHash;
  for (let i = 0; i < options.count; i++) {
    const seed = options.seed + i;
    const initialized = await api(i === 0 ? '/demo/traffic' : '/demo/traffic/reseed', 'POST', { seed });
    validateInitializedScene(initialized, seed);
    const routes = await api('/demo/routes');
    const hash = routeFingerprint(routes);
    const topologyStatus = routes.topologyStatus ?? 'UNAVAILABLE';
    const ambulanceHash = ambulanceRouteFingerprint(routes);
    if (expectedAmbulanceHash && ambulanceHash !== expectedAmbulanceHash) {
      throw new Error(`Ambulance base route changed between seeds: ${seed}; evaluation aborted`);
    }
    expectedAmbulanceHash = ambulanceHash;
    const evaluation = createDetectionEvaluation(seed, options.steps, hash, topologyStatus);
    for (let second = 1; second <= options.steps; second++) {
      const tick = await api('/demo/advance', 'POST', { deltaMs: 1000 });
      evaluation.acceptTick(tick);
    }
    const completed = { ...evaluation.finish(), ambulanceRouteHash: ambulanceHash };
    if (manifest && manifest.seed === seed) {
      compareAudits(manifest, completed.audit);
      onProgress(`Manifest replay verified for seed ${seed}.`);
    }
    runs.push(completed);
    onProgress(`Seed ${seed}: created=${completed.audit.totals.CREATED}, cleared=${completed.audit.totals.CLEARED}, ` +
      `completedDrivers=${completed.completedDriverCount}, suppressedObs=${completed.suppressedCandidateObservations}`);
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    origin: 'EV-RAS OPERATOR API / SYNTHETIC TRAFFIC',
    replayManifestVerified: manifest !== null,
    config: { startSeed: options.seed, seedCount: options.count, stepsPerSeed: options.steps, deltaMs: 1000 },
    summary: summarizeEvaluation(runs),
    runs,
  };
  // The files are persisted only after every run and optional manifest verification succeed.
  await persist(options.out, `${JSON.stringify(report, null, 2)}\n`);
  await persist(options.md, evaluationMarkdown(report));
  return report;
}

// Prevent importing the file from triggering the CLI (needed for unit tests).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = await evaluate(options, {
      baseUrl: process.env.EVRAS_API_URL ?? 'http://localhost:3000',
      key: process.env.EVRAS_DEMO_OPERATOR_KEY,
      onProgress: console.log,
    });
    const s = report.summary;
    console.log(`EVALUATION COMPLETE: ${s.runs} seeds, ${s.eventTotals.CREATED} created / ${s.eventTotals.CLEARED} cleared warnings.`);
    console.log(`Predicted ambulance ETA at creation: median=${s.predictedEmergencyEtaAtCreationSeconds.median ?? 'n/a'}s, ` +
      `p90=${s.predictedEmergencyEtaAtCreationSeconds.p90 ?? 'n/a'}s, ` +
      `missing=${s.predictedEmergencyEtaAtCreationSeconds.missing}.`);
    console.log(`Supported/suppressed candidate OBSERVATIONS: ${s.supportedCandidateObservations}/${s.suppressedCandidateObservations}.`);
    console.log(`Reports: ${options.out} and ${options.md}`);
    console.log('Real-world precision/recall and missed encounter counts are UNKNOWN without labeled ground truth.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
