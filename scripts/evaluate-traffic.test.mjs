import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAudit, routeFingerprint } from './lib/traffic-demo-audit.mjs';

const CLI = fileURLToPath(new URL('./evaluate-traffic.mjs', import.meta.url));
const vehicles = [{ id: 'AMB-001', kind: 'EMERGENCY' },
  ...Array.from({ length: 25 }, (_, i) => ({ id: `CAR-${String(i + 1).padStart(3, '0')}`, kind: 'CIVILIAN' }))];
const key = 'evras-test-operator-key';
const routes = vehicles.map((vehicle, i) => ({
  vehicleId: vehicle.id,
  distanceMeters: 100 + i,
  durationSeconds: 10 + i,
  coordinates: [[-75.75, 39.68], [-75.748 + i * 0.000001, 39.681]],
}));

function makeEvent(type, eta = 14) {
  return { type, alert: { id: 'encounter:AMB-001:CAR-025',
    emergencyVehicleId: 'AMB-001', civilianVehicleId: 'CAR-025',
    reason: 'CROSSING', emergencyEtaSeconds: eta,
    civilianEtaSeconds: eta + 1, etaDifferenceSeconds: 1 } };
}

function fakeTick(second, { withAlerts }) {
  const events = !withAlerts ? [] : second === 1 ? [makeEvent('CREATED')] :
    second === 2 ? [makeEvent('UPDATED')] : second === 3 ? [makeEvent('CLEARED')] : [];
  const isActive = withAlerts && [1, 2].includes(second);
  return { timeMs: second * 1000, events, encounterCount: isActive ? 1 : 0,
    suppressedCandidateCount: second === 1 ? 1 : 0,
    snapshot: { vehicles, alerts: isActive ? [{ civilianVehicleId: 'CAR-025' }] : [] } };
}

async function fakeApi({ warningSeed = 2028, geometryOffset = 0, rejectReseed = false,
  variableCivilianStarts = false, changeAmbulanceOnReseed = false } = {}) {
  let seed = 2026;
  let second = 0;
  const counters = { load: 0, reseed: 0, advance: 0, routes: 0 };
  const server = createServer(async (req, res) => {
    const json = (code, value) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.headers['x-demo-operator-key'] !== key) {
      json(401, { message: 'Unauthorized' });
      return;
    }
    let request = {};
    try {
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        request = JSON.parse(raw || '{}');
      }
      if (req.url === '/demo/traffic' || req.url === '/demo/traffic/reseed') {
        if (req.url === '/demo/traffic/reseed' && rejectReseed) {
          json(409, { message: 'Reseed blocked' });
          return;
        }
        if (req.url === '/demo/traffic') counters.load++;
        else counters.reseed++;
        seed = request.seed;
        second = 0;
        json(201, { active: true, source: 'OSRM', encounterEvaluation: 'TOPOLOGY_FILTERED',
          civilianCount: 25, seed, snapshot: { vehicles, alerts: [] } });
      } else if (req.url === '/demo/routes') {
        counters.routes++;
        json(200, { source: 'OSRM', topologyStatus: 'OSM_NODE_EVIDENCE',
          routes: routes.map((route) => ({ ...route, coordinates: route.coordinates.map(
            (coordinate, index) => [coordinate[0] + geometryOffset +
              (variableCivilianStarts && route.vehicleId !== 'AMB-001' && index === 0
                ? seed * 0.00000001 : 0) +
              (changeAmbulanceOnReseed && route.vehicleId === 'AMB-001' && counters.reseed > 0
                ? 0.001 : 0), coordinate[1]],
          ) })) });
      } else if (req.url === '/demo/advance') {
        counters.advance++;
        second++;
        json(201, fakeTick(second, { withAlerts: seed === warningSeed }));
      } else json(404, { message: 'Not found' });
    } catch (error) { json(500, { message: String(error) }); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}`, counters };
}

async function execute(args, url, { credential = key } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, EVRAS_API_URL: url,
        EVRAS_DEMO_OPERATOR_KEY: credential },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (buf) => { stdout += buf; });
    child.stderr.on('data', (buf) => { stderr += buf; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function withTempFile(run) {
  const dir = await mkdtemp(join(tmpdir(), 'evras12b-'));
  const out = join(dir, 'evaluation.json');
  const md = join(dir, 'evaluation.md');
  try { return await run({ dir, out, md }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('CLI evaluates genuine events, saves JSON and Markdown, uses cached reseed', async () => {
  const api = await fakeApi();
  try {
    await withTempFile(async ({ out, md }) => {
      const result = await execute([
        '--start-seed=2027', '--count=2', '--steps=4', `--out=${out}`, `--md=${md}`,
      ], api.url);
      assert.equal(result.code, 0, result.stderr);
      const report = JSON.parse(await readFile(out, 'utf8'));
      const markdown = await readFile(md, 'utf8');
      assert.equal(report.summary.runs, 2);
      assert.equal(report.summary.civilianDriverRuns, 50);
      assert.deepEqual(report.summary.seeds, [2027, 2028]);
      assert.deepEqual(report.summary.eventTotals, { CREATED: 1, UPDATED: 1, CLEARED: 1 });
      assert.equal(report.summary.predictedEmergencyEtaAtCreationSeconds.median, 14);
      assert.equal(report.summary.observedAlertActiveDurationSeconds.median, 2);
      assert.equal(report.summary.realWorldRecall, null);
      assert.equal(report.summary.suppressedCandidateObservations, 2);
      assert.match(markdown, /predicted ETAs, not observed real-world lead times/i);
      assert.match(result.stdout, /EVALUATION COMPLETE/);
      assert.equal(api.counters.load, 1);
      assert.equal(api.counters.reseed, 1);
      assert.equal(api.counters.advance, 8);
    });
  } finally { await closeServer(api.server); }
});

test('CLI accepts expected per-seed civilian starting-point changes', async () => {
  const api = await fakeApi({ variableCivilianStarts: true });
  try {
    await withTempFile(async ({ out, md }) => {
      const result = await execute([
        '--start-seed=2026', '--count=3', '--steps=4', `--out=${out}`, `--md=${md}`,
      ], api.url);
      assert.equal(result.code, 0, result.stderr);
      const report = JSON.parse(await readFile(out, 'utf8'));
      const markdown = await readFile(md, 'utf8');
      assert.equal(report.summary.runs, 3);
      assert.equal(new Set(report.runs.map((run) => run.geometryHash)).size, 3);
      assert.equal(new Set(report.runs.map((run) => run.ambulanceRouteHash)).size, 1);
      assert.equal(report.summary.roadGeometryHash, null);
      assert.equal(report.summary.roadGeometryHashesBySeed.length, 3);
      assert.match(markdown, /each seed changes civilian starting positions/i);
    });
  } finally { await closeServer(api.server); }
});

test('CLI detects a changed ambulance route despite seed-specific civilian differences', async () => {
  const api = await fakeApi({ variableCivilianStarts: true, changeAmbulanceOnReseed: true });
  try {
    await withTempFile(async ({ out, md }) => {
      const result = await execute([
        '--start-seed=2026', '--count=2', '--steps=4', `--out=${out}`, `--md=${md}`,
      ], api.url);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Ambulance base route changed between seeds: 2027/);
      await assert.rejects(readFile(out), { code: 'ENOENT' });
    });
  } finally { await closeServer(api.server); }
});

test('CLI with no simulated encounters reports zeros and unknown real-world recall', async () => {
  const api = await fakeApi({ warningSeed: -1 });
  try {
    await withTempFile(async ({ out, md }) => {
      const result = await execute([
        '--start-seed=2026', '--count=1', '--steps=4', `--out=${out}`, `--md=${md}`,
      ], api.url);
      assert.equal(result.code, 0, result.stderr);
      const report = JSON.parse(await readFile(out, 'utf8'));
      assert.equal(report.summary.createdEpisodes, 0);
      assert.equal(report.summary.predictedEmergencyEtaAtCreationSeconds.median, null);
      assert.equal(report.summary.realWorldFalseNegatives, null);
    });
  } finally { await closeServer(api.server); }
});

test('CLI fails gracefully if backend traffic reseed is unavailable', async () => {
  const api = await fakeApi({ rejectReseed: true });
  try {
    await withTempFile(async ({ out, md }) => {
      const result = await execute([
        '--start-seed=2026', '--count=2', '--steps=4', `--out=${out}`, `--md=${md}`,
      ], api.url);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Reseed blocked/);
      await assert.rejects(readFile(out), { code: 'ENOENT' });
    });
  } finally { await closeServer(api.server); }
});

test('CLI with valid 11B manifest reproduces its exact event timeline', async () => {
  const api = await fakeApi();
  try {
    await withTempFile(async ({ dir, out, md }) => {
      const hash = routeFingerprint({ source: 'OSRM', topologyStatus: 'OSM_NODE_EVIDENCE', routes });
      const audit = createAudit(2028, 4, hash, 'OSM_NODE_EVIDENCE');
      for (let i = 1; i <= 4; i++) audit.acceptTick(fakeTick(i, { withAlerts: true }));
      const saved = audit.finish();
      const manifest = join(dir, 'manifest.json');
      await import('node:fs/promises').then((fs) => fs.writeFile(manifest, JSON.stringify(saved)));
      const result = await execute([
        '--start-seed=2028', '--count=1', '--steps=4',
        `--manifest=${manifest}`, `--out=${out}`, `--md=${md}`,
      ], api.url);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Manifest replay verified/);
      const report = JSON.parse(await readFile(out, 'utf8'));
      assert.equal(report.replayManifestVerified, true);
    });
  } finally { await closeServer(api.server); }
});

test('CLI refuses a manifest if route geometry changed', async () => {
  const api = await fakeApi({ geometryOffset: 0.001 });
  try {
    await withTempFile(async ({ dir, out, md }) => {
      const hash = routeFingerprint({ source: 'OSRM', topologyStatus: 'OSM_NODE_EVIDENCE', routes });
      const audit = createAudit(2028, 4, hash, 'OSM_NODE_EVIDENCE');
      for (let i = 1; i <= 4; i++) audit.acceptTick(fakeTick(i, { withAlerts: true }));
      const manifest = join(dir, 'manifest.json');
      await import('node:fs/promises').then((fs) => fs.writeFile(manifest, JSON.stringify(audit.finish())));
      const result = await execute([
        '--start-seed=2028', '--count=1', '--steps=4',
        `--manifest=${manifest}`, `--out=${out}`, `--md=${md}`,
      ], api.url);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /replay differs/i);
      await assert.rejects(readFile(out), { code: 'ENOENT' });
    });
  } finally { await closeServer(api.server); }
});

test('CLI rejects operator API request without the correct secret', async () => {
  const api = await fakeApi();
  try {
    await withTempFile(async ({ out, md }) => {
      const result = await execute([
        '--start-seed=2028', '--count=1', '--steps=4', `--out=${out}`, `--md=${md}`,
      ], api.url, { credential: 'wrong-key' });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /HTTP 401/);
    });
  } finally { await closeServer(api.server); }
});

test('CLI rejects invalid argument ranges without contacting backend', async () => {
  const result = await execute(['--start-seed=4294967295', '--count=2'], 'http://127.0.0.1:1');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Invalid seed\/count/);
});

test('CLI rejects missing operator credential before contacting backend', async () => {
  const result = await execute(['--start-seed=2028', '--count=1'], 'http://127.0.0.1:1', { credential: '' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Missing EVRAS_DEMO_OPERATOR_KEY/);
});
