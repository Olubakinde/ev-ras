# EV-RAS — Temporal Warning Evaluation

**All results are from hand-authored synthetic road scenes. Not field measurements.**

## Method

- Detector evaluated every 1000 ms using actual EV-RAS domain logic and topology gating.
- Simulated vehicle crossings independently sampled every 100 ms and interpolated.
- Physical test label: manually designated at-grade connection and arrival difference ≤ 5 seconds.
- Benchmark late-warning threshold: less than 10 seconds before ambulance passage. This is not a safety standard.

## Classification and timing

| Cases | TP | FP | TN | FN | Precision | Recall | F1 | Late TP warnings |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 12 | 7 | 1 | 3 | 1 | 87.5% | 87.5% | 87.5% | 1 |

| Metric | Count | Min (s) | Mean (s) | Median (s) | p90 (s) | Max (s) |
|---|---:|---:|---:|---:|---:|---:|
| Warning lead (true positives) | 7 | 3.14 | 18.93 | 17.11 | 34.89 | 44.34 |
| Absolute first-warning ETA error (true positives) | 7 | 0.00 | 1.64 | 0.00 | 4.59 | 11.48 |

## Independent crossing and warning results

| Case | Physical outcome | Detector warned | TP/FP/TN/FN | Ambulance crossing (s) | Car crossing (s) | First warning (s) | Warning lead (s) | ETA error (s) | Late? | Created/Cleared |
|---|---|---|---|---:|---:|---:|---:|---:|---|---:|
| early-synchronized-crossing | Conflict | Yes | TP | 17.11 | 17.11 | 0.00 | 17.11 | 0.00 | No | 1/1 |
| late-synchronized-crossing | Conflict | Yes | TP | 3.14 | 3.13 | 0.00 | 3.14 | 0.00 | Yes | 1/1 |
| moderate-speed-crossing | Conflict | Yes | TP | 10.07 | 10.42 | 0.00 | 10.07 | -0.00 | No | 1/1 |
| overpass-no-road-connection | No conflict | No | TN | 17.11 | 17.11 | n/a | n/a | n/a | n/a | 0/0 |
| at-grade-missing-node-evidence | Conflict | No | FN | 17.11 | 17.11 | n/a | n/a | n/a | n/a | 0/0 |
| civilian-arrives-too-late | No conflict | No | TN | 9.51 | 44.48 | n/a | n/a | n/a | n/a | 0/0 |
| civilian-brakes-after-warning | No conflict | Yes | FP | 17.11 | 31.23 | 0.00 | 17.11 | 0.00 | n/a | 1/1 |
| civilian-accelerates-into-conflict | Conflict | Yes | TP | 17.11 | 15.13 | 5.00 | 12.11 | 0.00 | No | 1/1 |
| civilian-stop-and-go | Conflict | Yes | TP | 17.11 | 16.87 | 0.00 | 17.11 | 0.00 | No | 2/2 |
| approach-enters-prediction-horizon | Conflict | Yes | TP | 51.34 | 51.89 | 7.00 | 44.34 | 0.00 | No | 1/1 |
| stationary-emergency-vehicle | No conflict | No | TN | n/a | 17.11 | n/a | n/a | n/a | n/a | 0/0 |
| both-slow-after-initial-warning | Conflict | Yes | TP | 28.59 | 28.34 | 0.00 | 28.59 | -11.48 | No | 1/1 |

## Scenario rationale

- **early-synchronized-crossing:** Two vehicles approach a connected junction at similar arrival times, with about 17 seconds of travel remaining.
- **late-synchronized-crossing:** Same connected junction, but both vehicles begin only a few seconds away; an alert may arrive too late for the chosen ten-second benchmark.
- **moderate-speed-crossing:** Two connected approaches at different speeds arrive within the manually selected five-second temporal conflict window.
- **overpass-no-road-connection:** Both polylines intersect in the map plane, but the crossing is physically grade-separated, with different node identities.
- **at-grade-missing-node-evidence:** A genuine modeled at-grade conflict is deliberately missing the civilian OSM node annotation and should expose a fail-closed miss.
- **civilian-arrives-too-late:** Roads connect but vehicle arrival times differ by far more than five seconds; the physical policy label is negative.
- **civilian-brakes-after-warning:** Civilian slows after five seconds, so a warning based on initial constant speed can become a false alert for the final trajectory.
- **civilian-accelerates-into-conflict:** Civilian initially appears too slow to conflict but accelerates after five seconds; the detector must re-evaluate over time.
- **civilian-stop-and-go:** Civilian pauses for several seconds, then accelerates; lifecycle reconciliation should handle warning clearance and renewed detection.
- **approach-enters-prediction-horizon:** Both vehicles begin farther than the 45-second detector horizon; later snapshots should be evaluated as they approach.
- **stationary-emergency-vehicle:** Emergency vehicle remains stopped; it never reaches the declared junction, making this a physically negative case.
- **both-slow-after-initial-warning:** Both vehicles brake after an initially synchronized prediction; their actual crossing time shifts later, measuring how inaccurate the initial ETA becomes.

## Interpretation and limitations

- All route geometry, physical connectivity labels and speed profiles are synthetic and manually authored.
- Independent arrival times use the same deterministic simulation motion model, but never read detector ETAs or warning outcomes.
- A modeled at-grade crossing within five seconds is the test policy label; it is not a collision or observed emergency.
- Warning lead time is first CREATED time to simulated ambulance junction arrival, not measured human reaction time.
- The ten-second late threshold is an evaluation benchmark chosen for this study, not an established road-safety standard.
- One-second detection sampling and 100-millisecond arrival interpolation introduce finite timing resolution.
- Negative cases with an early warning are false positives relative to the final speed profile, not claims about field performance.
- These results are not real-world precision, recall, warning usefulness, or collision-prevention evidence.

These figures are NOT claims of real-world accuracy, road safety effectiveness, or collision prevention.
