# EV-RAS — Milestone 14: Temporal Encounter Evaluation

This milestone checks **when** the real EV-RAS detector issues an advisory relative to the **independently simulated time** at which an ambulance and car reach a manually specified road junction. It does not change the application, API, UI, routing, or detection policy.

## What's inside

- `apps/api/src/detection/evaluation/temporal-scenarios.ts` — 12 hand-authored synthetic time-series fixtures with independent physical-connectivity labels and speed-change schedules. Includes early, late, grade-separated, missing-evidence, delayed arrival, braking, acceleration, stop-and-go, horizon entry, and stopped ambulance cases.
- `apps/api/src/detection/evaluation/temporal-evaluator.ts` — reuses actual `createSimulation`, `advanceSimulation`, `detectEncounters`, topology gate, and `reconcileAlerts`; measures physical arrival via a separate 100-ms forward simulation without reading detector ETAs; computes TP/FP/TN/FN, warning lead times, ETA errors, and a ten-second late-warning benchmark.
- `apps/api/src/detection/evaluation/temporal-evaluator.spec.ts` — 27 Vitest regression and integration checks.
- `scripts/evaluate-temporal-encounters.mjs` — report generation CLI (runs offline with compiled NestJS code).
- `scripts/evaluate-temporal-encounters.test.mjs` — 6 Node CLI tests.

All files are NEW, no installer or new dependencies. No existing files are overwritten.

## Before you start

Milestone 13 must be merged into `main` and the local worktree must be clean. The following `git ls-files` command must return the prior evaluator fixture file:

```bash
cd ~/Projects/ev-ras
git switch main
git pull --ff-only origin main
git status -sb
git ls-files apps/api/src/detection/evaluation/labeled-scenarios.ts
```

Then:

```bash
git switch -c test/temporal-encounter-evaluation
unzip -o ~/Downloads/evras-milestone-14.zip -d .
```

## Validation

```bash
pnpm test:api
pnpm build:api
pnpm lint:api
node --test scripts/evaluate-temporal-encounters.test.mjs
pnpm test:web
pnpm typecheck:web
pnpm build:web
```

If 13 is merged and the other suites remain unchanged, expect 270 API tests (243 + 27), 6 Node CLI tests, and 58 web tests. Those are **targets**, not claims of verified full test results. Build only needs local dependencies; a running API or OSRM is not required.

## Produce the real evaluation report

```bash
node scripts/evaluate-temporal-encounters.mjs \
  --json=demo-reports/temporal-evaluation.json \
  --md=demo-reports/temporal-evaluation.md

cat demo-reports/temporal-evaluation.md
```

The report lists actual results of the synthetic fixture runs, including confusion matrix, early/late alerts, actual independently simulated crossing times, and first-alert ETA errors. **The report generation is not hardcoded to pass the cases.** A missing OSM annotation must count as a miss when the hand-authored road connection is physically at grade, and an initially reasonable warning can become a false alert if the civilian later brakes. The evaluator does not silently discard either.

## Critical definitions

- **Independent physical outcome:** An author-declared at-grade connection *and* two vehicle crossings measured within 5 seconds of each other. This 5-s window is a chosen test policy, not measured collision risk.
- **Physical crossing timestamp:** Simulate movement at 100-ms increments using EV-RAS motion rules; interpolate the moment each vehicle travels the route distance to the manually provided crossing vertex. This calculation does **not** use detector ETA or warning output. It **does** share the same simulator dynamics, so it is not independent real-world ground truth.
- **Lead time:** Actual simulated ambulance-crossing timestamp minus the time of the first `CREATED` alert for that case.
- **Late warning:** A true-positive case whose warning lead is below 10 seconds, a chosen evaluation benchmark only.
- **ETA prediction error:** `(first-warning time + predicted ambulance ETA) - independently measured ambulance arrival time` (signed; report aggregates absolute magnitudes).
- **Alert lifecycle:** Uses production `reconcileAlerts` to preserve event semantics.
- **Confusion matrix:** Any warning during the scenario compared with the final manually specified road connectivity and measured timing. A warning later invalidated by a speed change is counted as false positive against final trajectory; that does not prove it was unreasonable when generated.

## Known limitations

This is a small manually curated, entirely synthetic test suite. Its results are NOT estimates of real-road precision/recall, driver response time, warning safety adequacy, or collision prevention. Grade separation is an authored label. Crossings are schematic rather than OSRM roads. The detector is sampled once per second while physical arrival time is interpolated from 100-ms movement; neither is measured on live vehicles. Real-world validation will require independently annotated road traces and traffic behavior.

## Commit after verification

```bash
cd ~/Projects/ev-ras
git branch --show-current
git status -sb
git add apps/api/src/detection/evaluation/temporal-scenarios.ts \
  apps/api/src/detection/evaluation/temporal-evaluator.ts \
  apps/api/src/detection/evaluation/temporal-evaluator.spec.ts \
  scripts/evaluate-temporal-encounters.mjs \
  scripts/evaluate-temporal-encounters.test.mjs \
  README-14.md

# Add generated reports only after inspecting them:
git add demo-reports/temporal-evaluation.json demo-reports/temporal-evaluation.md

git diff --cached --check
git diff --cached --stat
git commit -m "test(detection): measure temporal warning lead times and ETA error"
git push -u origin test/temporal-encounter-evaluation
```

Open a pull request to `main`, review test and report output, then merge.
