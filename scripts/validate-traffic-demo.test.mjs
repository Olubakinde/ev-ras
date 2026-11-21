import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./validate-traffic-demo.mjs', import.meta.url));
const vehicles = [{ id: 'AMB-001', kind: 'EMERGENCY' },
  ...Array.from({ length: 25 }, (_, i) => ({ id: `CAR-${String(i + 1).padStart(3, '0')}`, kind: 'CIVILIAN' }))];
const key = 'operator-test-key';

async function fakeApi({ completeSeed = 2027, geometryOffset = 0 } = {}) {
  let seed = 2026;
  let second = 0;
  const server = createServer(async (req, res) => {
    let data = {};
    try {
      if (req.headers['x-demo-operator-key'] !== key) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        for await (const piece of req) body += piece;
        data = JSON.parse(body || '{}');
      }
      let payload;
      if (req.url === '/demo/traffic' || req.url === '/demo/traffic/reseed') {
        seed = data.seed;
        second = 0;
        payload = {
          active: true, seed, civilianCount: 25, source: 'OSRM',
          encounterEvaluation: 'TOPOLOGY_FILTERED',
          snapshot: { timeMs: 0, vehicles, alerts: [] },
        };
      } else if (req.url === '/demo/routes') {
        payload = { source: 'OSRM', topologyStatus: 'OSM_NODE_EVIDENCE',
          routes: vehicles.map((vehicle, i) => ({
            vehicleId: vehicle.id, distanceMeters: 50 + i,
            durationSeconds: 4 + i,
            coordinates: [[-75.75, 39.68], [-75.749 + geometryOffset + i * 0.000001, 39.681]],
          })),
        };
      } else if (req.url === '/demo/advance') {
        second++;
        const shouldWarn = seed === completeSeed;
        const events = shouldWarn && second === 1 ? [{ type: 'CREATED',
          alert: { civilianVehicleId: 'CAR-010', reason: 'CROSSING', emergencyVehicleId: 'AMB-001' } }] :
          shouldWarn && second === 2 ? [{ type: 'UPDATED',
            alert: { civilianVehicleId: 'CAR-010', reason: 'CROSSING', emergencyVehicleId: 'AMB-001' } }] :
          shouldWarn && second === 3 ? [{ type: 'CLEARED',
            alert: { civilianVehicleId: 'CAR-010', reason: 'CROSSING', emergencyVehicleId: 'AMB-001' } }] : [];
        const active = shouldWarn && (second === 1 || second === 2);
        payload = { timeMs: second * 1000, events, suppressedCandidateCount: 0,
          encounterCount: active ? 1 : 0,
          snapshot: { vehicles, alerts: active ? [{ civilianVehicleId: 'CAR-010' }] : [] },
        };
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function execute(args, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, EVRAS_API_URL: url, EVRAS_DEMO_OPERATOR_KEY: key },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (buf) => { stdout += buf; });
    child.stderr.on('data', (buf) => { stderr += buf; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('discovery persists only a completed alert lifecycle, and verify reproduces it', async () => {
  const { server, url } = await fakeApi();
  const dir = await mkdtemp(join(tmpdir(), 'evras11b-'));
  const file = join(dir, 'demo.json');
  try {
    const discovery = await execute([
      '--discover', '--start-seed=2026', '--count=2', '--steps=4', `--out=${file}`,
    ], url);
    assert.equal(discovery.code, 0, discovery.stderr);
    const data = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(data.validated, true);
    assert.equal(data.seed, 2027);
    assert.deepEqual(data.completedDrivers, ['CAR-010']);
    const verified = await execute([`--verify=${file}`], url);
    assert.equal(verified.code, 0, verified.stderr);
    assert.match(verified.stdout, /VERIFIED/);
    const armed = await execute([`--arm=${file}`], url);
    assert.equal(armed.code, 0, armed.stderr);
    assert.match(armed.stdout, /Armed 2027/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('no valid lifecycle produces a diagnostic, never a validated manifest', async () => {
  const { server, url } = await fakeApi({ completeSeed: -1 });
  const dir = await mkdtemp(join(tmpdir(), 'evras11b-'));
  const file = join(dir, 'demo.json');
  try {
    const result = await execute([
      '--discover', '--start-seed=2026', '--count=2', '--steps=4', `--out=${file}`,
    ], url);
    assert.equal(result.code, 1);
    const report = JSON.parse(await readFile(file.replace(/\.json$/, '.search.json'), 'utf8'));
    assert.equal(report.status, 'NO_VALIDATED_SCENARIO');
    assert.equal(report.search.length, 2);
    await assert.rejects(() => readFile(file, 'utf8'), { code: 'ENOENT' });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('saved manifest refuses changed OSRM geometry', async () => {
  const first = await fakeApi();
  const dir = await mkdtemp(join(tmpdir(), 'evras11b-'));
  const file = join(dir, 'demo.json');
  let second;
  try {
    const found = await execute([
      '--discover', '--start-seed=2027', '--count=1', '--steps=4', `--out=${file}`,
    ], first.url);
    assert.equal(found.code, 0, found.stderr);
    second = await fakeApi({ geometryOffset: 0.001 });
    const verified = await execute([`--verify=${file}`], second.url);
    assert.equal(verified.code, 1);
    assert.match(verified.stderr, /geometry differs/);
  } finally {
    first.server.closeAllConnections();
    await new Promise((resolve) => first.server.close(resolve));
    if (second) {
      second.server.closeAllConnections();
      await new Promise((resolve) => second.server.close(resolve));
    }
    await rm(dir, { recursive: true, force: true });
  }
});
