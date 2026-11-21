# EV-RAS — Labeled Synthetic Encounter Evaluation

**Dataset:** manually labeled, synthetic route geometry and node identities. **Not field data.**
**Detector:** EV-RAS production geometry detector with the 11A topology gate.

## Confusion matrix and metrics

| Group | Cases | TP | FP | TN | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Full labeled fixture | 17 | 6 | 0 | 9 | 2 | 100.0% | 75.0% | 85.7% |
| Complete node evidence | 15 | 6 | 0 | 9 | 0 | 100.0% | 100.0% | 100.0% |
| Deliberately missing annotations | 2 | 0 | 0 | 0 | 2 | n/a | 0.0% | 0.0% |
| Geometric-only baseline (diagnostic) | 17 | 8 | 2 | 7 | 0 | 80.0% | 100.0% | 88.9% |

TP = true positive; FP = false positive; TN = true negative; FN = false negative.
A missing-annotation positive that receives no alert is counted as **FN** by the manual label.

## Per-scenario results

| Scenario | Expected warning | Topology-gated warning | Geometry only | Result | Evidence |
|---|---|---|---|---|---|
| connected-crossing | Yes | Yes | Yes | TP | COMPLETE |
| connected-crossing-from-north | Yes | Yes | Yes | TP | COMPLETE |
| connected-crossing-different-speed | Yes | Yes | Yes | TP | COMPLETE |
| slower-car-on-shared-road | Yes | Yes | Yes | TP | COMPLETE |
| opposing-traffic-on-shared-road | Yes | Yes | Yes | TP | COMPLETE |
| stopped-on-ambulance-route | Yes | Yes | Yes | TP | COMPLETE |
| connected-crossing-with-missing-annotation | Yes | No | Yes | FN | MISSING_ANNOTATION |
| stopped-on-road-with-missing-annotation | Yes | No | Yes | FN | MISSING_ANNOTATION |
| overpass-without-junction | No | No | Yes | TN | COMPLETE |
| far-parallel-road | No | No | No | TN | COMPLETE |
| geometrically-near-but-disconnected | No | No | Yes | TN | COMPLETE |
| crossing-arrival-too-late | No | No | No | TN | COMPLETE |
| crossing-outside-arrival-window | No | No | No | TN | COMPLETE |
| intersection-already-behind-driver | No | No | No | TN | COMPLETE |
| stationary-on-unrelated-road | No | No | No | TN | COMPLETE |
| ambulance-is-not-moving | No | No | No | TN | COMPLETE |
| connected-crossing-beyond-horizon | No | No | No | TN | COMPLETE |

## Scenario design notes

- **connected-crossing** (AT_GRADE_CROSSING): Routes meet at an explicitly connected, at-grade node; predicted arrivals differ by under 5 seconds.
- **connected-crossing-from-north** (AT_GRADE_CROSSING): Same connected crossing approached from the other direction at similar arrival times.
- **connected-crossing-different-speed** (AT_GRADE_CROSSING): Approaches a connected intersection at 18 m/s, still inside the five-second arrival window.
- **slower-car-on-shared-road** (SHARED_ROAD): Driver moves ahead along the same directed road and shares the road-node edge identities.
- **opposing-traffic-on-shared-road** (SHARED_ROAD): Routes share a directed edge in reverse; vehicle and ambulance converge at its west end.
- **stopped-on-ambulance-route** (STATIONARY): A stopped car occupies an upcoming, identity-connected point on the ambulance path.
- **connected-crossing-with-missing-annotation** (ANNOTATION_GAP): The scenario is physically at-grade, but the driver-side crossing node annotation is missing. A fail-closed abstention counts as a missed positive.
- **stopped-on-road-with-missing-annotation** (ANNOTATION_GAP): The stopped car physically occupies the shared road point, but its node identity is unannotated. It remains a manually labeled positive.
- **overpass-without-junction** (GRADE_SEPARATION): Plan-view polylines cross at X, but this case defines a grade-separated overpass with different network node identities.
- **far-parallel-road** (UNRELATED_ROAD): The civilian stays over 30 m north of the ambulance road, without any shared edge or junction.
- **geometrically-near-but-disconnected** (UNRELATED_ROAD): The road centerlines lie within tolerance but represent different disconnected paths, as shown by distinct node identities.
- **crossing-arrival-too-late** (TIMING): The civilian approaches the same junction at 1 m/s: it arrives much too late for this prediction horizon.
- **crossing-outside-arrival-window** (TIMING): Driver arrival is more than five seconds after the ambulance, despite shared junction geometry.
- **intersection-already-behind-driver** (BEHIND): The car begins north of junction X and keeps traveling north. The shared intersection is behind it.
- **stationary-on-unrelated-road** (STATIONARY): Stopped vehicle is off the emergency route and has no matching road node or edge.
- **ambulance-is-not-moving** (TIMING): The emergency vehicle is stopped; the detector has no finite predicted ambulance arrival.
- **connected-crossing-beyond-horizon** (TIMING): Ambulance is about a kilometer west of the intersection; it cannot arrive within the 45-second horizon at 15 m/s.

## Limitations

- All labels are hand-authored scenarios, not independently observed real-road encounters.
- The road polylines and network-node identities are synthetic; no OSRM or live traffic is used.
- Precision and recall apply ONLY to this small, curated fixture set, not to field conditions.
- Missing OSM evidence causes fail-closed abstention; labeled physical positives can therefore be false negatives.
- One snapshot per scenario does not measure alert lead time, durability, or temporal tracking accuracy.
- A positive prediction is a modeled possible route encounter, not proof of a collision or required driver action.
