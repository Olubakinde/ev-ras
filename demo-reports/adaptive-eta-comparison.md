# EV-RAS — Experimental Adaptive ETA Comparison

**Synthetic evaluation only. No real-world accuracy or safety claim.**

Both estimators are evaluated on the same manually authored driving trajectories.
The table compares absolute ambulance ETA error only at matching warning update timestamps.

| Metric | Constant speed | Adaptive trend |
|---|---:|---:|
| Matched ETA observations | 151 | 151 |
| Mean absolute error (s) | 0.509 | 0.525 |
| Median absolute error (s) | 0.000 | 0.000 |

Warning classification changes: 0


## Limitations

- All fixtures are hand-authored synthetic scenes; this is NOT measured road performance.
- Matched-update errors exclude times when one model produced no warning; classificationChanges must be reviewed separately.
- An acceleration forecast does not anticipate arbitrary future stops or speed changes.
- Default detector behavior remains constant-speed unless EVRAS_ADAPTIVE_ETA=1 is enabled.
