# EV-RAS — Simulated Encounter Evaluation

Generated: 2026-11-21T06:04:16.027Z

**Scope:** One simulated ambulance and 25 simulated civilian vehicles per run,
moving along OSRM road geometry with the backend topology gate enabled.

- Evaluated seeds: 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037
- Shared ambulance route SHA-256: `ff041767240041f2af8cc41d227fc8cf01b28b1cb857925230aaea3568505097`
- Scene route SHA-256: varies by seed (see table below)
- Topology status across runs: `OSM_NODE_EVIDENCE`
- Warning events: 117 created, 989 updated, 117 cleared
- Completed / still-active alert episodes: 117 / 0
- Driver-run warnings: 84 of 300 (not recall)
- Supported / suppressed candidate **observations**: 1106 / 67

## Predicted warning lead time at creation

**These are backend-predicted ETAs, not observed real-world lead times.**

| Metric | Samples | Missing | Min | Median | P90 | Mean | Below 5 s | Below 10 s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Ambulance predicted ETA (s) | 117 | 0 | 0 | 10.951 | 34.833 | 15.262 | 35 | 51 |
| Civilian predicted ETA (s) | 74 | 43 | 0 | 10.794 | 41.152 | 15.788 | 29 | 35 |
| Alert active duration (s) | 117 | 0 | 1 | 5 | 23.8 | 9.453 | 41 | 78 |

## Per-seed results

| Seed | Drivers warned | Completed drivers | Created | Updated | Cleared | Active at end | Supported candidate observations | Suppressed candidate observations |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026 | 7 | 7 | 13 | 103 | 13 | 0 | 116 | 4 |
| 2027 | 6 | 6 | 7 | 80 | 7 | 0 | 87 | 11 |
| 2028 | 8 | 8 | 12 | 55 | 12 | 0 | 67 | 2 |
| 2029 | 7 | 7 | 8 | 100 | 8 | 0 | 108 | 5 |
| 2030 | 7 | 7 | 8 | 66 | 8 | 0 | 74 | 4 |
| 2031 | 8 | 8 | 12 | 59 | 12 | 0 | 71 | 6 |
| 2032 | 7 | 7 | 9 | 91 | 9 | 0 | 100 | 11 |
| 2033 | 7 | 7 | 13 | 84 | 13 | 0 | 97 | 12 |
| 2034 | 6 | 6 | 8 | 113 | 8 | 0 | 121 | 4 |
| 2035 | 7 | 7 | 9 | 82 | 9 | 0 | 91 | 5 |
| 2036 | 8 | 8 | 11 | 71 | 11 | 0 | 82 | 2 |
| 2037 | 6 | 6 | 7 | 85 | 7 | 0 | 92 | 1 |

## Route geometry by seed

The SHA-256 fingerprint describes each complete 26-vehicle scene, **not** the unchanged OSRM template pool.
Each seed changes civilian starting positions and therefore legitimately changes its scene fingerprint.

| Seed | Scene route SHA-256 | Topology status |
|---:|---|---|
| 2026 | `8833ef8a87ce7097cef73bf782672e2a56fe8b848e8b6703aa3af69698155925` | OSM_NODE_EVIDENCE |
| 2027 | `183ee535640e7c4d88164a3e262a9f4676286b50d82b5ee8a5634471b05d0285` | OSM_NODE_EVIDENCE |
| 2028 | `070294b891adde6d8b5f825114ee31831c96894bc1fea2ed385a000caf7aaec7` | OSM_NODE_EVIDENCE |
| 2029 | `e49d721ddce101c40ace81ce9fb22ead08580f38e2e6420b1b96c166275a8f37` | OSM_NODE_EVIDENCE |
| 2030 | `f82cf2a7907043005711579506e61d1fdf1484edd09dcac9cb760ea1ac33c2fb` | OSM_NODE_EVIDENCE |
| 2031 | `3429187d65dac74cdd474f48b2e97c9ced20bce118e8b58a01d944b15975e812` | OSM_NODE_EVIDENCE |
| 2032 | `5ed7505f2aa64608c29f1669f8f72b0795114dfd235bdb1b09a446194c05295e` | OSM_NODE_EVIDENCE |
| 2033 | `79e79294ca8f87c0e762fd0b2f72cdfd26603ecb73b6b610ccc50b29d243e7b2` | OSM_NODE_EVIDENCE |
| 2034 | `e588740752286d857fd5bc4bc4ded69506f1fcb601d0ef69c5a12cfbfa8710ad` | OSM_NODE_EVIDENCE |
| 2035 | `1ce3f29d9c6955195516b453a1c80efe8ed4d9c8598aa17d827a3b292908a94d` | OSM_NODE_EVIDENCE |
| 2036 | `79314da8a962bb01faf269e6aa9c8b0f4c414e2f4c7426377b7d1b0c55bb2fbf` | OSM_NODE_EVIDENCE |
| 2037 | `2bd72ac69d4ddbdcd459089321e95df96ffd80ecac8504271b7539f9085e8d87` | OSM_NODE_EVIDENCE |

## Interpretation limits

- Traffic positions, speeds, and warnings are simulated; route geometry comes from OSRM.
- Synthetic car starting positions vary by seed, so their complete 26-vehicle route fingerprints normally differ. The operator API reseeds against cached OSRM templates.
- The ambulance route fingerprint is checked across seeds. Individual car routes are fingerprinted per seed; no source-template hash is exposed by the API.
- ETAs are model predictions captured at alert creation, not measured warning lead times.
- Supported/suppressed candidate counters count per-tick observations, not unique encounters.
- Driver warning frequency is not real-world detection recall or a safety performance rate.
- False positives, false negatives, and misses require independently labeled ground truth.

## Follow-up evaluation

To estimate false positives, missed encounters, precision, recall, or actual intervention lead time,
construct an independently labeled reference set (time-synchronized trajectories and verified conflict events),
then compare each predicted alert to the reference. The present report does not make those claims.

