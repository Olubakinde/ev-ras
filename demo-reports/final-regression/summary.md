# EV-RAS — Final Regression Evaluation (Milestone 15C)

Status: **PASS**
Generated: 2026-11-22T05:49:28.272Z

**Scope:** Regression checks on manually labeled synthetic fixtures, independent simulated crossing times, and experimental matched-time ETA comparison. None are real-world accuracy or safety-effectiveness measurements.

## Default prediction model

- Production default remains **constant speed**. The experimental adaptive estimator is not promoted.
- Offline commands explicitly set `EVRAS_ADAPTIVE_ETA=0`.
- The report is a guard against changes to the *current curated fixtures*, not proof of generalization.

## Synthetic benchmarks

| Evaluation | Cases/observations | TP | FP | TN | FN |
|---|---:|---:|---:|---:|---:|
| Labeled | 17 | 6 | 0 | 9 | 2 |
| Temporal | 12 | 7 | 1 | 3 | 1 |

- Late temporal warnings (synthetic 10-second benchmark): 1
- Median observed synthetic warning lead time: 17.115 seconds
- First-warning ETA-error p90: 4.590 seconds
- Matched ETA observations: 151
- Constant-speed mean absolute ETA error: 0.509 seconds
- Adaptive mean absolute ETA error: 0.525 seconds
- Estimator classification changes: 0

## Regression gates

- PASS — Labeled report is explicitly synthetic
- PASS — Labeled report uses topology-gated baseline
- PASS — Labeled: samples stays at documented fixture baseline (17)
- PASS — Labeled: truePositive stays at documented fixture baseline (6)
- PASS — Labeled: falsePositive stays at documented fixture baseline (0)
- PASS — Labeled: trueNegative stays at documented fixture baseline (9)
- PASS — Labeled: falseNegative stays at documented fixture baseline (2)
- PASS — Temporal: samples stays at documented fixture baseline (12)
- PASS — Temporal: truePositive stays at documented fixture baseline (7)
- PASS — Temporal: falsePositive stays at documented fixture baseline (1)
- PASS — Temporal: trueNegative stays at documented fixture baseline (3)
- PASS — Temporal: falseNegative stays at documented fixture baseline (1)
- PASS — Labeled case connected-crossing classification matches independent label and detector verdict
- PASS — Labeled case connected-crossing-from-north classification matches independent label and detector verdict
- PASS — Labeled case connected-crossing-different-speed classification matches independent label and detector verdict
- PASS — Labeled case slower-car-on-shared-road classification matches independent label and detector verdict
- PASS — Labeled case opposing-traffic-on-shared-road classification matches independent label and detector verdict
- PASS — Labeled case stopped-on-ambulance-route classification matches independent label and detector verdict
- PASS — Labeled case connected-crossing-with-missing-annotation classification matches independent label and detector verdict
- PASS — Labeled case stopped-on-road-with-missing-annotation classification matches independent label and detector verdict
- PASS — Labeled case overpass-without-junction classification matches independent label and detector verdict
- PASS — Labeled case far-parallel-road classification matches independent label and detector verdict
- PASS — Labeled case geometrically-near-but-disconnected classification matches independent label and detector verdict
- PASS — Labeled case crossing-arrival-too-late classification matches independent label and detector verdict
- PASS — Labeled case crossing-outside-arrival-window classification matches independent label and detector verdict
- PASS — Labeled case intersection-already-behind-driver classification matches independent label and detector verdict
- PASS — Labeled case stationary-on-unrelated-road classification matches independent label and detector verdict
- PASS — Labeled case ambulance-is-not-moving classification matches independent label and detector verdict
- PASS — Labeled case connected-crossing-beyond-horizon classification matches independent label and detector verdict
- PASS — Temporal case early-synchronized-crossing matches independent arrival label and detector verdict
- PASS — Temporal case early-synchronized-crossing keeps its independently labeled baseline outcome
- PASS — Temporal case late-synchronized-crossing matches independent arrival label and detector verdict
- PASS — Temporal case late-synchronized-crossing keeps its independently labeled baseline outcome
- PASS — Temporal case moderate-speed-crossing matches independent arrival label and detector verdict
- PASS — Temporal case moderate-speed-crossing keeps its independently labeled baseline outcome
- PASS — Temporal case overpass-no-road-connection matches independent arrival label and detector verdict
- PASS — Temporal case overpass-no-road-connection keeps its independently labeled baseline outcome
- PASS — Temporal case at-grade-missing-node-evidence matches independent arrival label and detector verdict
- PASS — Temporal case at-grade-missing-node-evidence keeps its independently labeled baseline outcome
- PASS — Temporal case civilian-arrives-too-late matches independent arrival label and detector verdict
- PASS — Temporal case civilian-arrives-too-late keeps its independently labeled baseline outcome
- PASS — Temporal case civilian-brakes-after-warning matches independent arrival label and detector verdict
- PASS — Temporal case civilian-brakes-after-warning keeps its independently labeled baseline outcome
- PASS — Temporal case civilian-accelerates-into-conflict matches independent arrival label and detector verdict
- PASS — Temporal case civilian-accelerates-into-conflict keeps its independently labeled baseline outcome
- PASS — Temporal case civilian-stop-and-go matches independent arrival label and detector verdict
- PASS — Temporal case civilian-stop-and-go keeps its independently labeled baseline outcome
- PASS — Temporal case approach-enters-prediction-horizon matches independent arrival label and detector verdict
- PASS — Temporal case approach-enters-prediction-horizon keeps its independently labeled baseline outcome
- PASS — Temporal case stationary-emergency-vehicle matches independent arrival label and detector verdict
- PASS — Temporal case stationary-emergency-vehicle keeps its independently labeled baseline outcome
- PASS — Temporal case both-slow-after-initial-warning matches independent arrival label and detector verdict
- PASS — Temporal case both-slow-after-initial-warning keeps its independently labeled baseline outcome
- PASS — No temporal benchmark cases have been added or silently dropped
- PASS — Labeled reported samples matches case outcomes
- PASS — Temporal reported samples matches case outcomes
- PASS — Labeled reported truePositive matches case outcomes
- PASS — Temporal reported truePositive matches case outcomes
- PASS — Labeled reported falsePositive matches case outcomes
- PASS — Temporal reported falsePositive matches case outcomes
- PASS — Labeled reported trueNegative matches case outcomes
- PASS — Temporal reported trueNegative matches case outcomes
- PASS — Labeled reported falseNegative matches case outcomes
- PASS — Temporal reported falseNegative matches case outcomes
- PASS — Labeled confusion counts sum to fixture size
- PASS — Temporal confusion counts sum to fixture size
- PASS — Two known missing-evidence false negatives remain visible
- PASS — Missing road evidence still withholds a warning (known tradeoff)
- PASS — Grade-separated overpass remains unwarned
- PASS — Temporal sampling remains 1s detector / 100ms independent arrival
- PASS — No additional late true-positive warnings relative to fixture benchmark
- PASS — Temporal first-warning ETA-error p90 does not exceed documented fixture tolerance (4.60s)
- PASS — Temporal TP early-synchronized-crossing contains finite observed simulated lead time
- PASS — Temporal TP late-synchronized-crossing contains finite observed simulated lead time
- PASS — Temporal TP moderate-speed-crossing contains finite observed simulated lead time
- PASS — Temporal TP civilian-accelerates-into-conflict contains finite observed simulated lead time
- PASS — Temporal TP civilian-stop-and-go contains finite observed simulated lead time
- PASS — Temporal TP approach-enters-prediction-horizon contains finite observed simulated lead time
- PASS — Temporal TP both-slow-after-initial-warning contains finite observed simulated lead time
- PASS — ETA comparison uses matched simulation warning timestamps
- PASS — ETA comparison retains 14 synthetic cases
- PASS — ETA comparison retains 151 matched observations
- PASS — No warning classification changes between baseline and experimental estimator
- PASS — Constant-speed mean ETA error does not exceed fixture tolerance (0.55s)
- PASS — Experimental ETA error is measured, not assumed to be better

## Optional operator-API traffic replay

- Status: **PASS**
- 12-seed warning count: 117 created / 117 cleared
- Supported/suppressed candidate **observations**: 1106 / 67

The server configuration cannot be independently determined through existing API endpoints. Run the API with `EVRAS_ADAPTIVE_ETA=0` for a baseline live comparison.
- PASS — Live evaluation is labeled synthetic operator traffic
- PASS — Live traffic evaluated 12 seeds with 25 civilian vehicles each
- PASS — Live operator scene includes 300 civilian driver-runs
- PASS — Live traffic produced at least one modeled alert
- PASS — All live created alerts were eventually cleared
- PASS — No modeled warnings remain active at end of replay
- PASS — Ambulance source route fingerprint is present
- PASS — Per-seed created warning totals reconcile

## Known limitations

- Missing OSM annotations can cause fail-closed missed synthetic encounters; topology recovery cannot create unsupported road-node identities.
- Variable speeds can invalidate an earlier warning or ETA; the adaptive estimate did not outperform the baseline in the previously tested synthetic fixtures.
- The 10-second late-warning threshold is a research benchmark, **not** a road-safety standard.
- Simulated warning lead time is not human reaction time. No measured field precision, recall, or collision-prevention evidence is available.
- OSRM route geometry and connectivity evidence may change over time; scene hashes and validated manifests must be rechecked.

This evaluation is NOT a road-use authorization or statement of operational safety.
