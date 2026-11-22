/**
 * EV-RAS Milestone 15C: a regression gate over documented synthetic fixtures.
 * This module is pure: it never starts a server, accesses files, or reruns an
 * estimator. All labels and numeric measurements come from existing evaluators.
 *
 * These checks freeze known fixture results, NOT real-world safety thresholds.
 */

export const KNOWN_BASELINE = Object.freeze({
  labeled: Object.freeze({ samples: 17, truePositive: 6, falsePositive: 0, trueNegative: 9, falseNegative: 2 }),
  temporal: Object.freeze({ samples: 12, truePositive: 7, falsePositive: 1, trueNegative: 3, falseNegative: 1 }),
  maximumLateWarnings: 1,
  maximumTemporalEtaP90Seconds: 4.60,
  expectedComparisonScenarios: 14,
  expectedPairedObservations: 151,
  maximumBaselineMeanEtaErrorSeconds: 0.55,
  temporalCaseOutcomes: Object.freeze({
    'early-synchronized-crossing': 'TP',
    'late-synchronized-crossing': 'TP',
    'moderate-speed-crossing': 'TP',
    'overpass-no-road-connection': 'TN',
    'at-grade-missing-node-evidence': 'FN',
    'civilian-arrives-too-late': 'TN',
    'civilian-brakes-after-warning': 'FP',
    'civilian-accelerates-into-conflict': 'TP',
    'civilian-stop-and-go': 'TP',
    'approach-enters-prediction-horizon': 'TP',
    'stationary-emergency-vehicle': 'TN',
    'both-slow-after-initial-warning': 'TP',
  }),
});

const counts = ['truePositive', 'falsePositive', 'trueNegative', 'falseNegative'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}
function requireFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}
function asNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative integer`);
  return value;
}
function check(condition, description, findings) {
  findings.push({ pass: Boolean(condition), description });
}
function metricsFromCases(cases, label) {
  if (!Array.isArray(cases) || !cases.length) throw new Error(`${label} must have cases`);
  const unique = new Set();
  const result = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
  for (const item of cases) {
    requireObject(item, `${label} case`);
    if (typeof item.id !== 'string' || !item.id.trim() || unique.has(item.id)) {
      throw new Error(`${label} contains empty or duplicate case identifiers`);
    }
    unique.add(item.id);
    if (!['TP', 'FP', 'TN', 'FN'].includes(item.outcome)) throw new Error(`${label} contains an unknown outcome`);
    result[{ TP: 'truePositive', FP: 'falsePositive', TN: 'trueNegative', FN: 'falseNegative' }[item.outcome]]++;
  }
  return { samples: unique.size, ...result };
}
function compareMetricCounts(actual, expected, prefix, findings) {
  for (const key of ['samples', ...counts]) {
    check(asNonnegativeInteger(actual[key], `${prefix}.${key}`) === expected[key],
      `${prefix}: ${key} stays at documented fixture baseline (${expected[key]})`, findings);
  }
}
function sumStats(actual) {
  return counts.reduce((acc, key) => acc + asNonnegativeInteger(actual[key], `metrics.${key}`), 0);
}

export function evaluateOfflineReports({ labeled, temporal, comparison }) {
  requireObject(labeled, 'labeled report');
  requireObject(temporal, 'temporal report');
  requireObject(comparison, 'ETA comparison');
  const findings = [];
  check(labeled.evaluationKind === 'HAND_LABELED_SYNTHETIC_ROAD_CASES',
    'Labeled report is explicitly synthetic', findings);
  check(labeled.detector === 'TOPOLOGY_GATED_BASELINE',
    'Labeled report uses topology-gated baseline', findings);

  const labeledObserved = metricsFromCases(labeled.cases, 'labeled');
  const temporalObserved = metricsFromCases(temporal.cases, 'temporal');
  const labeledMetrics = requireObject(labeled.metrics, 'labeled metrics');
  const temporalMetrics = requireObject(temporal.metrics, 'temporal metrics');
  compareMetricCounts(labeledMetrics, KNOWN_BASELINE.labeled, 'Labeled', findings);
  compareMetricCounts(temporalMetrics, KNOWN_BASELINE.temporal, 'Temporal', findings);
  for (const item of labeled.cases) {
    if (typeof item.expectedAlert !== 'boolean' || typeof item.predictedAlert !== 'boolean') {
      throw new Error(`Labeled case ${item.id} is missing expected/predicted boolean fields`);
    }
    const expected = item.expectedAlert ? (item.predictedAlert ? 'TP' : 'FN') : (item.predictedAlert ? 'FP' : 'TN');
    check(item.outcome === expected, `Labeled case ${item.id} classification matches independent label and detector verdict`, findings);
  }
  for (const item of temporal.cases) {
    if (typeof item.independentlyExpectedEncounter !== 'boolean' || typeof item.anyWarningIssued !== 'boolean') {
      throw new Error(`Temporal case ${item.id} is missing independently expected encounter or detector verdict`);
    }
    const expected = item.independentlyExpectedEncounter ? (item.anyWarningIssued ? 'TP' : 'FN') : (item.anyWarningIssued ? 'FP' : 'TN');
    check(item.outcome === expected, `Temporal case ${item.id} matches independent arrival label and detector verdict`, findings);
    check(item.outcome === KNOWN_BASELINE.temporalCaseOutcomes[item.id],
      `Temporal case ${item.id} keeps its independently labeled baseline outcome`, findings);
  }
  check(temporal.cases.length === Object.keys(KNOWN_BASELINE.temporalCaseOutcomes).length,
    'No temporal benchmark cases have been added or silently dropped', findings);
  for (const key of ['samples', ...counts]) {
    check(labeledObserved[key] === labeledMetrics[key], `Labeled reported ${key} matches case outcomes`, findings);
    check(temporalObserved[key] === temporalMetrics[key], `Temporal reported ${key} matches case outcomes`, findings);
  }
  check(sumStats(labeledMetrics) === labeledMetrics.samples, 'Labeled confusion counts sum to fixture size', findings);
  check(sumStats(temporalMetrics) === temporalMetrics.samples, 'Temporal confusion counts sum to fixture size', findings);

  const missingMetrics = requireObject(labeled.missingAnnotationMetrics, 'missing annotation metrics');
  check(missingMetrics.falseNegative === 2, 'Two known missing-evidence false negatives remain visible', findings);
  const missingTemporal = temporal.cases.find(item => item.id === 'at-grade-missing-node-evidence');
  check(missingTemporal?.outcome === 'FN' && missingTemporal?.anyWarningIssued === false,
    'Missing road evidence still withholds a warning (known tradeoff)', findings);
  const overpass = temporal.cases.find(item => item.id === 'overpass-no-road-connection');
  check(overpass?.outcome === 'TN' && overpass?.anyWarningIssued === false,
    'Grade-separated overpass remains unwarned', findings);

  const temporalSimulation = requireObject(temporal.simulation, 'temporal simulation');
  check(temporalSimulation.detectorStepMs === 1000 && temporalSimulation.independentArrivalStepMs === 100,
    'Temporal sampling remains 1s detector / 100ms independent arrival', findings);
  const lateWarnings = asNonnegativeInteger(temporal.lateTruePositiveWarnings, 'late warnings');
  check(lateWarnings <= KNOWN_BASELINE.maximumLateWarnings,
    'No additional late true-positive warnings relative to fixture benchmark', findings);
  const etaStats = requireObject(temporal.absoluteEtaPredictionErrorSeconds, 'temporal ETA error stats');
  check(requireFinite(etaStats.p90, 'temporal p90') <= KNOWN_BASELINE.maximumTemporalEtaP90Seconds,
    'Temporal first-warning ETA-error p90 does not exceed documented fixture tolerance (4.60s)', findings);
  for (const item of temporal.cases) {
    if (item.outcome === 'TP') {
      check(typeof item.warningLeadSeconds === 'number' && Number.isFinite(item.warningLeadSeconds),
        `Temporal TP ${item.id} contains finite observed simulated lead time`, findings);
    }
  }

  check(comparison.comparisonKind === 'MATCHED_SIMULATED_ALERT_UPDATE_TIMES',
    'ETA comparison uses matched simulation warning timestamps', findings);
  check(comparison.scenarios === KNOWN_BASELINE.expectedComparisonScenarios,
    'ETA comparison retains 14 synthetic cases', findings);
  check(Array.isArray(comparison.pairedSamples) &&
    comparison.pairedSamples.length === KNOWN_BASELINE.expectedPairedObservations,
    'ETA comparison retains 151 matched observations', findings);
  check(Array.isArray(comparison.classificationChanges) && comparison.classificationChanges.length === 0,
    'No warning classification changes between baseline and experimental estimator', findings);
  const baselineError = requireObject(comparison.baselineAbsoluteErrorSeconds, 'baseline ETA errors');
  const adaptiveError = requireObject(comparison.adaptiveAbsoluteErrorSeconds, 'adaptive ETA errors');
  check(requireFinite(baselineError.mean, 'baseline ETA mean error') <=
    KNOWN_BASELINE.maximumBaselineMeanEtaErrorSeconds,
    'Constant-speed mean ETA error does not exceed fixture tolerance (0.55s)', findings);
  check(Number.isFinite(adaptiveError.mean) && adaptiveError.mean >= 0,
    'Experimental ETA error is measured, not assumed to be better', findings);

  return {
    passed: findings.every(item => item.pass), findings,
    baselineMode: 'CONSTANT_SPEED; EVRAS_ADAPTIVE_ETA=0 on evaluation subprocesses',
    labeled: labeled.metrics,
    temporal: {
      metrics: temporal.metrics,
      lateTruePositiveWarnings: temporal.lateTruePositiveWarnings,
      warningLeadSeconds: temporal.warningLeadSeconds,
      absoluteEtaPredictionErrorSeconds: temporal.absoluteEtaPredictionErrorSeconds,
    },
    etaComparison: {
      observations: comparison.pairedSamples.length,
      baselineMeanAbsoluteErrorSeconds: baselineError.mean,
      adaptiveMeanAbsoluteErrorSeconds: adaptiveError.mean,
      classificationChanges: comparison.classificationChanges.length,
    },
  };
}

export function evaluateLiveReport(live) {
  requireObject(live, 'live traffic report');
  const summary = requireObject(live.summary, 'live summary');
  const totals = requireObject(summary.eventTotals, 'live event totals');
  const findings = [];
  check(live.origin === 'EV-RAS OPERATOR API / SYNTHETIC TRAFFIC',
    'Live evaluation is labeled synthetic operator traffic', findings);
  check(summary.runs === 12 && live.runs?.length === 12 && summary.civilianDriversPerRun === 25,
    'Live traffic evaluated 12 seeds with 25 civilian vehicles each', findings);
  check(summary.civilianDriverRuns === 300, 'Live operator scene includes 300 civilian driver-runs', findings);
  check(asNonnegativeInteger(totals.CREATED, 'created alerts') > 0,
    'Live traffic produced at least one modeled alert', findings);
  check(totals.CREATED === totals.CLEARED, 'All live created alerts were eventually cleared', findings);
  check(summary.stillActiveEpisodes === 0, 'No modeled warnings remain active at end of replay', findings);
  check(typeof summary.ambulanceRouteHash === 'string' && summary.ambulanceRouteHash.length === 64,
    'Ambulance source route fingerprint is present', findings);
  const createdFromRuns = live.runs?.reduce((total, run) => total + (run.audit?.totals?.CREATED ?? 0), 0);
  check(createdFromRuns === totals.CREATED, 'Per-seed created warning totals reconcile', findings);
  return { passed: findings.every(f => f.pass), findings,
    results: { seeds: summary.seeds, eventTotals: totals,
      predictedEmergencyEtaAtCreationSeconds: summary.predictedEmergencyEtaAtCreationSeconds,
      supportedCandidateObservations: summary.supportedCandidateObservations,
      suppressedCandidateObservations: summary.suppressedCandidateObservations },
  };
}

export function formatFinalMarkdown(report) {
  const rows = [
    '# EV-RAS — Final Regression Evaluation (Milestone 15C)', '',
    `Status: **${report.passed ? 'PASS' : 'FAIL'}**`,
    `Generated: ${report.generatedAt}`, '',
    '**Scope:** Regression checks on manually labeled synthetic fixtures, independent simulated crossing times, and experimental matched-time ETA comparison. None are real-world accuracy or safety-effectiveness measurements.',
    '',
    '## Default prediction model', '',
    '- Production default remains **constant speed**. The experimental adaptive estimator is not promoted.',
    '- Offline commands explicitly set `EVRAS_ADAPTIVE_ETA=0`.',
    '- The report is a guard against changes to the *current curated fixtures*, not proof of generalization.', '',
    '## Synthetic benchmarks', '',
    '| Evaluation | Cases/observations | TP | FP | TN | FN |',
    '|---|---:|---:|---:|---:|---:|',
    `| Labeled | ${report.offline.labeled.samples} | ${report.offline.labeled.truePositive} | ${report.offline.labeled.falsePositive} | ${report.offline.labeled.trueNegative} | ${report.offline.labeled.falseNegative} |`,
    `| Temporal | ${report.offline.temporal.metrics.samples} | ${report.offline.temporal.metrics.truePositive} | ${report.offline.temporal.metrics.falsePositive} | ${report.offline.temporal.metrics.trueNegative} | ${report.offline.temporal.metrics.falseNegative} |`,
    '',
    `- Late temporal warnings (synthetic 10-second benchmark): ${report.offline.temporal.lateTruePositiveWarnings}`,
    `- Median observed synthetic warning lead time: ${report.offline.temporal.warningLeadSeconds.median?.toFixed(3) ?? 'n/a'} seconds`,
    `- First-warning ETA-error p90: ${report.offline.temporal.absoluteEtaPredictionErrorSeconds.p90?.toFixed(3) ?? 'n/a'} seconds`,
    `- Matched ETA observations: ${report.offline.etaComparison.observations}`,
    `- Constant-speed mean absolute ETA error: ${report.offline.etaComparison.baselineMeanAbsoluteErrorSeconds.toFixed(3)} seconds`,
    `- Adaptive mean absolute ETA error: ${report.offline.etaComparison.adaptiveMeanAbsoluteErrorSeconds.toFixed(3)} seconds`,
    `- Estimator classification changes: ${report.offline.etaComparison.classificationChanges}`, '',
    '## Regression gates', '',
  ];
  for (const finding of report.offline.findings) rows.push(`- ${finding.pass ? 'PASS' : 'FAIL'} — ${finding.description}`);
  if (report.live) {
    rows.push('', '## Optional operator-API traffic replay', '',
      `- Status: **${report.live.passed ? 'PASS' : 'FAIL'}**`,
      `- 12-seed warning count: ${report.live.results.eventTotals.CREATED} created / ${report.live.results.eventTotals.CLEARED} cleared`,
      `- Supported/suppressed candidate **observations**: ${report.live.results.supportedCandidateObservations} / ${report.live.results.suppressedCandidateObservations}`, '',
      'The server configuration cannot be independently determined through existing API endpoints. Run the API with `EVRAS_ADAPTIVE_ETA=0` for a baseline live comparison.',
    );
    for (const finding of report.live.findings) rows.push(`- ${finding.pass ? 'PASS' : 'FAIL'} — ${finding.description}`);
  } else {
    rows.push('', '## Optional operator-API traffic replay', '',
      'Not run. Start the backend in baseline mode and rerun with `--live` if you want to validate 12 live OSRM-based seeds.',
    );
  }
  rows.push('', '## Known limitations', '',
    '- Missing OSM annotations can cause fail-closed missed synthetic encounters; topology recovery cannot create unsupported road-node identities.',
    '- Variable speeds can invalidate an earlier warning or ETA; the adaptive estimate did not outperform the baseline in the previously tested synthetic fixtures.',
    '- The 10-second late-warning threshold is a research benchmark, **not** a road-safety standard.',
    '- Simulated warning lead time is not human reaction time. No measured field precision, recall, or collision-prevention evidence is available.',
    '- OSRM route geometry and connectivity evidence may change over time; scene hashes and validated manifests must be rechecked.',
    '', 'This evaluation is NOT a road-use authorization or statement of operational safety.', '');
  return rows.join('\n');
}
