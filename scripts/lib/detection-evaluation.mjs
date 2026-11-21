/**
 * EV-RAS Milestone 12B: evaluation of observed operator API responses.
 *
 * This module intentionally makes NO inference about real-world precision,
 * recall, missed emergency vehicles, or ground-truth encounter times.
 * The ETA measurements here are the detector's predictions at alert creation.
 */
import { createAudit, validSeed } from './traffic-demo-audit.mjs';
import { createHash } from 'node:crypto';

const CAR_COUNT = 25;

function assert(condition, message) {
  if (!condition) throw new Error(`Detection evaluation: ${message}`);
}

function maybeEta(alert, field) {
  const value = alert[field];
  if (value === undefined || value === null) return null;
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0,
    `${field} must be nonnegative and finite when present`);
  return value;
}

function rounded(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Unlike a complete 26-car scene, the ambulance route is invariant under
 * synthetic traffic reseeding. Its hash catches a changed base route while
 * allowing cars to start at different positions on cached OSRM templates.
 * The 26-car routeFingerprint is still recorded independently for every seed.
 */
export function ambulanceRouteFingerprint(metadata) {
  assert(metadata?.source === 'OSRM' && Array.isArray(metadata.routes),
    'expected OSRM route metadata');
  const matches = metadata.routes.filter((route) => route?.vehicleId === 'AMB-001');
  assert(matches.length === 1, 'expected exactly one ambulance route');
  const route = matches[0];
  assert(Array.isArray(route.coordinates) && route.coordinates.length >= 2 &&
    Number.isFinite(route.distanceMeters) && route.distanceMeters > 0 &&
    Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0 &&
    route.coordinates.every((c) => Array.isArray(c) && c.length === 2 &&
      c.every((value) => Number.isFinite(value))),
    'invalid ambulance route geometry');
  return createHash('sha256').update(JSON.stringify([
    route.distanceMeters, route.durationSeconds, route.coordinates,
  ])).digest('hex');
}

/** Counts represent observations (a vehicle may appear in many ticks). */
export function numericSummary(values, missingCount = 0) {
  assert(Array.isArray(values) && Number.isSafeInteger(missingCount) && missingCount >= 0,
    'invalid numeric sample collection');
  assert(values.every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0),
    'numeric samples must be finite and nonnegative');
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 0) {
    return { samples: 0, missing: missingCount, min: null, p10: null,
      median: null, mean: null, p90: null, max: null, below5: 0, below10: 0 };
  }
  return {
    samples: ordered.length,
    missing: missingCount,
    min: rounded(ordered[0]),
    p10: rounded(percentile(ordered, 0.10)),
    median: rounded(percentile(ordered, 0.50)),
    mean: rounded(ordered.reduce((acc, next) => acc + next, 0) / ordered.length),
    p90: rounded(percentile(ordered, 0.90)),
    max: rounded(ordered.at(-1)),
    below5: ordered.filter((value) => value < 5).length,
    below10: ordered.filter((value) => value < 10).length,
  };
}

function summarizeEpisodes(episodes) {
  const created = episodes;
  const finished = created.filter((episode) => episode.clearedAtSecond !== null);
  const reasons = {};
  for (const episode of created) reasons[episode.reason] = (reasons[episode.reason] ?? 0) + 1;
  const emergencyEtas = created.map((episode) => episode.predictedEmergencyEtaSeconds);
  const civilianEtas = created.map((episode) => episode.predictedCivilianEtaSeconds);
  return {
    createdEpisodes: created.length,
    completedEpisodes: finished.length,
    stillActiveEpisodes: created.length - finished.length,
    reasons: Object.fromEntries(Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b))),
    predictedEmergencyEtaAtCreationSeconds: numericSummary(
      emergencyEtas.filter((value) => value !== null), emergencyEtas.filter((value) => value === null).length),
    predictedCivilianEtaAtCreationSeconds: numericSummary(
      civilianEtas.filter((value) => value !== null), civilianEtas.filter((value) => value === null).length),
    observedAlertActiveDurationSeconds: numericSummary(
      finished.map((episode) => episode.clearedAtSecond - episode.createdAtSecond)),
  };
}

/**
 * Every tick is first audited with the strict Milestone 11B event/state checker.
 * Multiple CREATED->CLEARED episodes for the same driver are preserved.
 */
export function createDetectionEvaluation(seed, steps, geometryHash, topologyStatus) {
  assert(validSeed(seed), 'seed must be an unsigned 32-bit integer');
  const audit = createAudit(seed, steps, geometryHash, topologyStatus);
  const active = new Map();
  const episodes = [];
  let received = 0;

  return {
    acceptTick(tick) {
      audit.acceptTick(tick); // Reject invalid ordering and mismatched active alerts.
      const second = tick.timeMs / 1000;
      for (const event of tick.events) {
        const { type, alert } = event;
        const driverId = alert.civilianVehicleId;
        if (type === 'CREATED') {
          assert(!active.has(driverId), `duplicate creation for ${driverId}`);
          const entry = {
            driverId,
            alertId: typeof alert.id === 'string' ? alert.id : null,
            reason: typeof alert.reason === 'string' && alert.reason.length > 0
              ? alert.reason : 'UNKNOWN',
            classification: typeof alert.classification === 'string' ? alert.classification : null,
            createdAtSecond: second,
            clearedAtSecond: null,
            durationSeconds: null,
            updateCount: 0,
            predictedEmergencyEtaSeconds: maybeEta(alert, 'emergencyEtaSeconds'),
            predictedCivilianEtaSeconds: maybeEta(alert, 'civilianEtaSeconds'),
            predictedEtaDifferenceSeconds: maybeEta(alert, 'etaDifferenceSeconds'),
          };
          active.set(driverId, entry);
          episodes.push(entry);
        } else if (type === 'UPDATED') {
          const entry = active.get(driverId);
          assert(entry !== undefined, `orphan update for ${driverId}`);
          entry.updateCount++;
        } else if (type === 'CLEARED') {
          const entry = active.get(driverId);
          assert(entry !== undefined, `orphan clear for ${driverId}`);
          entry.clearedAtSecond = second;
          entry.durationSeconds = rounded(second - entry.createdAtSecond);
          active.delete(driverId);
        }
      }
      received++;
    },
    finish() {
      assert(received === steps, 'missing simulation ticks');
      const audited = audit.finish();
      assert(audited.totals.CREATED === episodes.length, 'audit event totals disagree');
      assert(audited.activeAtEnd.length === active.size, 'active warning counts disagree');
      return {
        seed, steps, geometryHash, topologyStatus,
        source: 'OSRM_SIMULATION',
        vehicleCount: CAR_COUNT + 1,
        audit: audited,
        episodes: episodes.map((episode) => ({ ...episode })),
        metrics: summarizeEpisodes(episodes),
        warnedDriverCount: audited.warnedDrivers.length,
        completedDriverCount: audited.completedDrivers.length,
        suppressedCandidateObservations: audited.suppressedCandidates,
        supportedCandidateObservations: audited.supportedCandidates,
      };
    },
  };
}

export function summarizeEvaluation(runs) {
  assert(Array.isArray(runs) && runs.length > 0, 'at least one evaluated run is required');
  const seeds = new Set();
  const ambulanceHash = runs[0].ambulanceRouteHash ?? null;
  for (const run of runs) {
    assert(!seeds.has(run.seed), 'duplicate seed in evaluation results');
    assert((run.ambulanceRouteHash ?? null) === ambulanceHash,
      'ambulance base route changed between runs');
    seeds.add(run.seed);
  }
  // Full scene geometry legitimately varies with seed: each synthetic car
  // starts at a different point along a cached source route template.
  const sceneHashes = new Set(runs.map((run) => run.geometryHash));
  const topologyStatuses = new Set(runs.map((run) => run.topologyStatus));
  const episodes = runs.flatMap((run) => run.episodes);
  const allMetrics = summarizeEpisodes(episodes);
  const totals = { CREATED: 0, UPDATED: 0, CLEARED: 0 };
  for (const run of runs) {
    for (const type of Object.keys(totals)) totals[type] += run.audit.totals[type];
  }
  return {
    source: 'OSRM_SIMULATION',
    // Only expose a single whole-scene hash if every seed has that exact scene.
    roadGeometryHash: sceneHashes.size === 1 ? runs[0].geometryHash : null,
    roadGeometryHashesBySeed: runs.map(({ seed, geometryHash }) => ({ seed, geometryHash })),
    ambulanceRouteHash: ambulanceHash,
    topologyStatus: topologyStatuses.size === 1 ? runs[0].topologyStatus : 'MIXED',
    topologyStatusesBySeed: runs.map(({ seed, topologyStatus }) => ({ seed, topologyStatus })),
    seeds: runs.map((run) => run.seed),
    runs: runs.length,
    civilianDriversPerRun: CAR_COUNT,
    civilianDriverRuns: CAR_COUNT * runs.length,
    driverRunsWithAnyWarning: runs.reduce((sum, run) => sum + run.warnedDriverCount, 0),
    driverRunsWithCompletedWarning: runs.reduce((sum, run) => sum + run.completedDriverCount, 0),
    eventTotals: totals,
    suppressedCandidateObservations: runs.reduce((sum, run) => sum + run.suppressedCandidateObservations, 0),
    supportedCandidateObservations: runs.reduce((sum, run) => sum + run.supportedCandidateObservations, 0),
    ...allMetrics,
    realWorldFalsePositives: null,
    realWorldFalseNegatives: null,
    realWorldRecall: null,
    limitations: [
      'Traffic positions, speeds, and warnings are simulated; route geometry comes from OSRM.',
      'Synthetic car starting positions vary by seed, so their complete 26-vehicle route fingerprints normally differ. The operator API reseeds against cached OSRM templates.',
      'The ambulance route fingerprint is checked across seeds. Individual car routes are fingerprinted per seed; no source-template hash is exposed by the API.',
      'ETAs are model predictions captured at alert creation, not measured warning lead times.',
      'Supported/suppressed candidate counters count per-tick observations, not unique encounters.',
      'Driver warning frequency is not real-world detection recall or a safety performance rate.',
      'False positives, false negatives, and misses require independently labeled ground truth.',
    ],
  };
}

function printable(value, suffix = '') {
  return value === null ? 'n/a' : `${value}${suffix}`;
}

/** Markdown generated from actual run evidence, never demo-only claims. */
export function evaluationMarkdown(report) {
  const { summary, runs } = report;
  const lines = [
    '# EV-RAS — Simulated Encounter Evaluation',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '**Scope:** One simulated ambulance and 25 simulated civilian vehicles per run,',
    'moving along OSRM road geometry with the backend topology gate enabled.',
    '',
    `- Evaluated seeds: ${summary.seeds.join(', ')}`,
    `- Shared ambulance route SHA-256: \`${summary.ambulanceRouteHash ?? 'not available'}\``,
    `- Scene route SHA-256: ${summary.roadGeometryHash ?? 'varies by seed (see table below)'}`,
    `- Topology status across runs: \`${summary.topologyStatus}\``,
    `- Warning events: ${summary.eventTotals.CREATED} created, ${summary.eventTotals.UPDATED} updated, ${summary.eventTotals.CLEARED} cleared`,
    `- Completed / still-active alert episodes: ${summary.completedEpisodes} / ${summary.stillActiveEpisodes}`,
    `- Driver-run warnings: ${summary.driverRunsWithAnyWarning} of ${summary.civilianDriverRuns} (not recall)`,
    `- Supported / suppressed candidate **observations**: ${summary.supportedCandidateObservations} / ${summary.suppressedCandidateObservations}`,
    '',
    '## Predicted warning lead time at creation',
    '',
    '**These are backend-predicted ETAs, not observed real-world lead times.**',
    '',
    '| Metric | Samples | Missing | Min | Median | P90 | Mean | Below 5 s | Below 10 s |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [label, metric] of [
    ['Ambulance predicted ETA (s)', summary.predictedEmergencyEtaAtCreationSeconds],
    ['Civilian predicted ETA (s)', summary.predictedCivilianEtaAtCreationSeconds],
    ['Alert active duration (s)', summary.observedAlertActiveDurationSeconds],
  ]) {
    lines.push(`| ${label} | ${metric.samples} | ${metric.missing} | ${printable(metric.min)} | ${printable(metric.median)} | ${printable(metric.p90)} | ${printable(metric.mean)} | ${metric.below5} | ${metric.below10} |`);
  }
  lines.push('', '## Per-seed results', '',
    '| Seed | Drivers warned | Completed drivers | Created | Updated | Cleared | Active at end | Supported candidate observations | Suppressed candidate observations |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const run of runs) {
    const t = run.audit.totals;
    lines.push(`| ${run.seed} | ${run.warnedDriverCount} | ${run.completedDriverCount} | ${t.CREATED} | ${t.UPDATED} | ${t.CLEARED} | ${run.metrics.stillActiveEpisodes} | ${run.supportedCandidateObservations} | ${run.suppressedCandidateObservations} |`);
  }
  lines.push('', '## Route geometry by seed', '',
    'The SHA-256 fingerprint describes each complete 26-vehicle scene, **not** the unchanged OSRM template pool.',
    'Each seed changes civilian starting positions and therefore legitimately changes its scene fingerprint.',
    '', '| Seed | Scene route SHA-256 | Topology status |', '|---:|---|---|');
  for (const run of runs) {
    lines.push(`| ${run.seed} | \`${run.geometryHash}\` | ${run.topologyStatus} |`);
  }
  lines.push('', '## Interpretation limits', '');
  for (const limitation of summary.limitations) lines.push(`- ${limitation}`);
  lines.push('', '## Follow-up evaluation', '',
    'To estimate false positives, missed encounters, precision, recall, or actual intervention lead time,',
    'construct an independently labeled reference set (time-synchronized trajectories and verified conflict events),',
    'then compare each predicted alert to the reference. The present report does not make those claims.', '');
  return `${lines.join('\n')}\n`;
}
