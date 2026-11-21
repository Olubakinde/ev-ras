import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validSeed, validateInitializedScene, routeFingerprint, createAudit,
  scoreAudit, compareAudits, assertValidManifest,
} from './traffic-demo-audit.mjs';

const pos = (i) => [-75.75 + i * 0.0001, 39.68 + i * 0.0001];
const vehicles = [
  { id: 'AMB-001', kind: 'EMERGENCY' },
  ...Array.from({ length: 25 }, (_, i) => ({ id: `CAR-${String(i + 1).padStart(3, '0')}`, kind: 'CIVILIAN' })),
];
const scene = (seed = 2026) => ({
  active: true, seed, source: 'OSRM', encounterEvaluation: 'TOPOLOGY_FILTERED',
  civilianCount: 25, snapshot: { vehicles },
});
const routes = (reverse = false) => ({
  source: 'OSRM', topologyStatus: 'OSM_NODE_EVIDENCE',
  routes: (reverse ? [...vehicles].reverse() : vehicles).map((v, i) => ({
    vehicleId: v.id, distanceMeters: 20, durationSeconds: 2,
    coordinates: [pos(0), pos(1), pos(2)],
  })),
});
const event = (type, driverId = 'CAR-010') => ({
  type, alert: { civilianVehicleId: driverId, emergencyVehicleId: 'AMB-001', reason: 'CROSSING' },
});
const tick = (n, events = [], alertIds = []) => ({
  timeMs: n * 1000, suppressedCandidateCount: 1, encounterCount: alertIds.length,
  events, snapshot: { vehicles, alerts: alertIds.map((id) => ({ civilianVehicleId: id })) },
});
const HASH = 'a'.repeat(64);
function completed() {
  const audit = createAudit(2026, 3, HASH, 'OSM_NODE_EVIDENCE');
  audit.acceptTick(tick(1, [event('CREATED')], ['CAR-010']));
  audit.acceptTick(tick(2, [event('UPDATED')], ['CAR-010']));
  audit.acceptTick(tick(3, [event('CLEARED')], []));
  return audit.finish();
}

test('accepts 32-bit seeds including boundaries', () => {
  assert.equal(validSeed(0), true);
  assert.equal(validSeed(0xffffffff), true);
  assert.equal(validSeed(-1), false);
  assert.equal(validSeed(2.5), false);
  assert.equal(validSeed(0x100000000), false);
});

test('validates 26 authenticated operator-scene vehicles', () => {
  assert.doesNotThrow(() => validateInitializedScene(scene(), 2026));
});

test('rejects malformed and duplicate vehicle scenes', () => {
  const wrong = scene();
  wrong.snapshot = { vehicles: [...vehicles.slice(0, 25), vehicles[0]] };
  assert.throws(() => validateInitializedScene(wrong, 2026), /unique/);
  assert.throws(() => validateInitializedScene(scene(), 7), /requested/);
});

test('route geometry hashes are independent of order', () => {
  assert.equal(routeFingerprint(routes()), routeFingerprint(routes(true)));
});

test('changing a mapped road point invalidates route hash', () => {
  const edited = routes();
  edited.routes[0].coordinates = [pos(0), pos(1), pos(3)];
  assert.notEqual(routeFingerprint(edited), routeFingerprint(routes()));
});

test('routes without geometry are rejected rather than trusted', () => {
  const edited = routes();
  edited.routes[0].coordinates = [];
  assert.throws(() => routeFingerprint(edited), /invalid/);
});

test('created, updated, and cleared produces a verified lifecycle', () => {
  const result = completed();
  assert.equal(result.validated, true);
  assert.deepEqual(result.completedDrivers, ['CAR-010']);
  assert.deepEqual(result.totals, { CREATED: 1, UPDATED: 1, CLEARED: 1 });
  assert.equal(result.supportedCandidates, 2);
  assert.equal(result.suppressedCandidates, 3);
});

test('no warning remains unvalidated', () => {
  const audit = createAudit(42, 2, HASH, 'UNAVAILABLE');
  audit.acceptTick(tick(1));
  audit.acceptTick(tick(2));
  assert.equal(audit.finish().validated, false);
});

test('created but never cleared is not a verified lifecycle', () => {
  const audit = createAudit(42, 1, HASH, 'OSM_NODE_EVIDENCE');
  audit.acceptTick(tick(1, [event('CREATED')], ['CAR-010']));
  assert.equal(audit.finish().validated, false);
});

test('rejects clearing an alert that was never created', () => {
  const audit = createAudit(42, 1, HASH, 'OSM_NODE_EVIDENCE');
  assert.throws(() => audit.acceptTick(tick(1, [event('CLEARED')])), /without CREATED/);
});

test('rejects updates for drivers without an active alert', () => {
  const audit = createAudit(42, 1, HASH, 'OSM_NODE_EVIDENCE');
  assert.throws(() => audit.acceptTick(tick(1, [event('UPDATED')])), /without CREATED/);
});

test('rejects inaccurate time and mismatched active-alert snapshot', () => {
  const audit = createAudit(42, 1, HASH, 'OSM_NODE_EVIDENCE');
  assert.throws(() => audit.acceptTick(tick(2)), /invalid tick/);
  const next = createAudit(42, 1, HASH, 'OSM_NODE_EVIDENCE');
  assert.throws(() => next.acceptTick(tick(1, [event('CREATED')], [])), /disagree/);
});

test('repeating the same completed timeline verifies successfully', () => {
  assert.equal(compareAudits(completed(), completed()), true);
});

test('replay with changed road geometry fails validation', () => {
  const oldRun = completed();
  const changed = { ...completed(), geometryHash: 'b'.repeat(64) };
  assert.throws(() => compareAudits(oldRun, changed), /differs/);
});

test('replay with changed timing or alert order fails validation', () => {
  const oldRun = completed();
  const changed = { ...completed(), timeline: [{ ...oldRun.timeline[0], second: 2 }] };
  assert.throws(() => compareAudits(oldRun, changed), /differs/);
});

test('unverified manifests cannot be used for demo arming', () => {
  const manifest = { ...completed(), validated: false };
  assert.throws(() => assertValidManifest(manifest), /not a completed/);
});

test('score prioritizes drivers whose warning lifecycle completed', () => {
  assert.ok(scoreAudit(completed()) > scoreAudit({
    ...completed(), completedDrivers: [], totals: { CREATED: 1, UPDATED: 0, CLEARED: 0 },
    warnedDrivers: ['CAR-010'],
  }));
});
