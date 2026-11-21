#!/usr/bin/env node
/**
 * Operator-only, sequential traffic replay inspector. Does not fake alerts.
 * Runs the real NestJS simulation and records its actual emitted events.
 * Example: EVRAS_DEMO_OPERATOR_KEY='...' node scripts/replay-traffic.mjs --seed=2026 --steps=90
 */
const baseUrl = process.env.EVRAS_API_URL ?? 'http://localhost:3000';
const operatorKey = process.env.EVRAS_DEMO_OPERATOR_KEY;

const options = { seed: 2026, steps: 90, existing: false };
for (const argument of process.argv.slice(2)) {
  if (argument === '--existing') options.existing = true;
  else if (argument.startsWith('--seed=')) options.seed = Number(argument.slice(7));
  else if (argument.startsWith('--steps=')) options.steps = Number(argument.slice(8));
  else {
    console.error(`Unknown option: ${argument}`);
    process.exit(2);
  }
}
if (!operatorKey || !Number.isSafeInteger(options.seed) || options.seed < 0 ||
    options.seed > 0xffffffff || !Number.isSafeInteger(options.steps) ||
    options.steps < 1 || options.steps > 240) {
  console.error('Set EVRAS_DEMO_OPERATOR_KEY and use --seed=0..4294967295, --steps=1..240 [--existing].');
  process.exit(2);
}

async function api(path, method = 'GET', body) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      'x-demo-operator-key': operatorKey,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

try {
  if (!options.existing) {
    console.log(`Loading real-road mixed traffic (seed ${options.seed})...`);
    const initialized = await api('/demo/traffic', 'POST', { seed: options.seed });
    if (initialized.civilianCount !== 25 || initialized.snapshot?.vehicles?.length !== 26) {
      throw new Error('Traffic initialization did not return 25 cars and one ambulance.');
    }
  } else {
    const status = await api('/demo/traffic');
    if (!status.active) throw new Error('No traffic scenario is active. Omit --existing to initialize one.');
    console.log('Replaying currently loaded traffic without reinitializing.');
  }

  const totals = { CREATED: 0, UPDATED: 0, CLEARED: 0 };
  const warnedDrivers = new Set();
  let last;
  for (let tick = 1; tick <= options.steps; tick++) {
    last = await api('/demo/advance', 'POST', { deltaMs: 1000 });
    const events = Array.isArray(last.events) ? last.events : [];
    for (const event of events) {
      if (!(event.type in totals)) continue;
      totals[event.type]++;
      if (event.type === 'CREATED') warnedDrivers.add(event.alert.civilianVehicleId);
      console.log(`[${String(last.timeMs / 1000).padStart(3)}s] ${event.type.padEnd(7)} ${event.alert.civilianVehicleId} ` +
        `${event.alert.reason} ETA=${event.alert.emergencyEtaSeconds.toFixed(1)}s`);
    }
  }
  console.log('\nReplay summary (experimental simulated advisories):');
  console.log(JSON.stringify({
    seed: options.existing ? 'currently loaded' : options.seed,
    simulatedSeconds: options.steps,
    vehicleCount: last.snapshot?.vehicles?.length,
    created: totals.CREATED,
    updated: totals.UPDATED,
    cleared: totals.CLEARED,
    distinctWarnedDrivers: [...warnedDrivers].sort(),
    activeAtEnd: last.snapshot?.alerts?.length ?? 0,
    topologyStatus: 'See GET /demo/routes for evidence availability',
  }, null, 2));
  if (!warnedDrivers.size) {
    console.log('No supported encounters occurred in this run. This is valid output, not a test failure.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
