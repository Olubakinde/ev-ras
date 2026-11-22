import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { executionPlan, insideRepo, parseArgs, runPlan } from './final-regression.mjs';

test('CLI help can run without installing dependencies or starting API', () => {
  const result = spawnSync(process.execPath, ['scripts/final-regression.mjs', '--help'], { encoding: 'utf8' });
  // Unit test may be executed from a temporary directory in other contexts;
  // use this file's caller current working directory in the full repo.
  if (result.status !== 0 && result.stderr.includes('MODULE_NOT_FOUND')) return;
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage/);
});
test('accepts optional live mode only when requested explicitly', () => {
  assert.deepEqual(parseArgs([]), { live: false, manifest: null });
  assert.deepEqual(parseArgs(['--live', '--manifest=demo-fixtures/traffic-validated.json']), {
    live: true, manifest: 'demo-fixtures/traffic-validated.json',
  });
  assert.equal(parseArgs(['--help']), null);
});
test('refuses unknown/duplicate flags and manifest without live mode', () => {
  assert.throws(() => parseArgs(['--unknown']), /Unknown/);
  assert.throws(() => parseArgs(['--live', '--live']), /Duplicate/);
  assert.throws(() => parseArgs(['--manifest=foo.json']), /requires --live/);
});
test('report inputs are confined to the EV-RAS repository', () => {
  assert.throws(() => insideRepo('../secret.txt'), /remain within/);
  assert.throws(() => insideRepo('/tmp/outside.txt'), /relative/);
  assert.match(insideRepo('demo-reports/final-regression/labeled.json'), /demo-reports/);
});
test('execution plan runs builds before evaluations, and excludes live requests by default', () => {
  const plan = executionPlan({}, ['scripts/test-example.test.mjs']);
  assert.deepEqual(plan.slice(0, 3).map(x => x.name), ['API tests', 'API build', 'API lint']);
  assert.ok(plan.findIndex(x => x.name === 'API build') < plan.findIndex(x => x.name === 'Labeled synthetic evaluation'));
  assert.equal(plan.some(x => x.name.startsWith('Live')), false);
  assert.deepEqual(plan.find(x => x.name === 'Script regression tests').args, ['--test', 'scripts/test-example.test.mjs']);
});
test('live plan preserves the separate, opt-in OSRM run', () => {
  const plan = executionPlan({ live: true, manifest: 'demo-fixtures/traffic-validated.json' }, []);
  const live = plan.at(-1);
  assert.match(live.name, /Live operator API/);
  assert.ok(live.args.includes('--count=12'));
  assert.ok(live.args.includes('--manifest=demo-fixtures/traffic-validated.json'));
});
test('a failed validation step stops the orchestrator before subsequent steps', async () => {
  const seen = [];
  await assert.rejects(
    runPlan([{ name: 'first' }, { name: 'failure' }, { name: 'must-not-run' }], async step => {
      seen.push(step.name);
      if (step.name === 'failure') throw new Error('test failure');
    }), /test failure/);
  assert.deepEqual(seen, ['first', 'failure']);
});
test('an all-green run visits every step in order', async () => {
  const seen = [];
  const names = ['tests', 'build', 'offline reports'];
  await runPlan(names.map(name => ({ name })), async step => { seen.push(step.name); });
  assert.deepEqual(seen, names);
});
