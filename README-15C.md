# EV-RAS — Milestone 15C: Final Regression Gate

This milestone adds **no new UI, API, simulation, or detector behavior**. It creates a reproducible release gate around the already evaluated constant-speed baseline. It keeps missing-topology false negatives visible rather than relabeling them as negatives or disabling the safety-conscious topology check.

## Contents

- `scripts/lib/final-regression.mjs`: pure regression gate for existing labeled, temporal and adaptive A/B report formats, plus optional 12-seed operator API traffic results. Enforces known fixture outcomes, independent-label consistency and a few explicitly documented fixture-specific tolerances.
- `scripts/lib/final-regression.test.mjs`: tests that the gate catches missed encounters, false positives, relabeled fixtures, grade-separated overpass regressions, late alerts and incomplete live alert lifecycles.
- `scripts/final-regression.mjs`: one-command orchestration of API/web tests, builds, lint, all Node script tests, offline reports, a final consolidated JSON/Markdown report. Optional `--live` uses your already running NestJS operator API to run 12 OSRM-based seeds.
- `scripts/final-regression.test.mjs`: CLI argument, path safety, order and fail-fast tests.

### Important scope

- The labeled cases are a **small manually authored synthetic fixture set**, not a statistically representative real-world sample.
- The 10-second lead-time threshold is **not** a road-safety standard.
- The adaptive estimator is **not automatically promoted**. The runner sets `EVRAS_ADAPTIVE_ETA=0` in its subprocesses, preserving the measured baseline.
- The original missing-node-evidence false negatives remain known limitations. Their presence is checked so that failures cannot be hidden by silently changing scenario labels.
- The regression gate does **not** claim real-world precision/recall, intervention effectiveness, or collision prevention.
- Live evaluation is **opt-in** because it resets and advances the backend's shared operator scenario. Do **not** use while anyone is playing with the frontend demo.

## Prerequisites and Git branch

Make sure the **15B PR has been merged into GitHub `main`**. In your terminal:

```bash
cd ~/Projects/ev-ras
git status -sb
git switch main
git pull --ff-only origin main
git status -sb
git ls-files apps/api/src/detection/domain/adaptive-eta.ts
```

If the file is not tracked, merge 15B before creating the branch. Do not reset or discard uncommitted files.

```bash
git switch -c test/final-regression-gate
```

Download the ZIP and extract it into the repository. It contains **only new files**; it does not overwrite existing application source.

```bash
unzip -o ~/Downloads/evras-milestone-15c.zip -d .
```

## Quick check: tests for the new regression gate

```bash
node --test scripts/lib/final-regression.test.mjs scripts/final-regression.test.mjs
```

The package passed **26 new Node tests** in the packaging environment. The full application suites still need to run in your repo.

## Default: full offline regression command

```bash
node scripts/final-regression.mjs
```

The command executes, in order:

1. `pnpm test:api`, `pnpm build:api`, `pnpm lint:api`.
2. `pnpm test:web`, `pnpm typecheck:web`, `pnpm build:web`.
3. All `scripts/*.test.mjs` and `scripts/lib/*.test.mjs` Node tests (including 15C).
4. The real compiled labeled synthetic evaluator (17 cases).
5. The real compiled temporal evaluator (12 cases).
6. Constant speed vs. experimental adaptive ETA on 14 cases (151 matched observations).
7. Check the generated JSON reports against the **previously verified** fixture baselines and produce a consolidated result.

Output:

- `demo-reports/final-regression/summary.json`
- `demo-reports/final-regression/summary.md`
- `demo-reports/final-regression/labeled.{json,md}`
- `demo-reports/final-regression/temporal.{json,md}`
- `demo-reports/final-regression/eta-comparison.{json,md}`

Expected gate inputs based on your verified previous reports:

| Fixture | Previously verified results | Gate intent |
|---|---|---|
| Labeled (17) | TP=6, FP=0, TN=9, FN=2 | Detect changed fixture classifications; keep topology abstentions visible |
| Temporal (12) | TP=7, FP=1, TN=3, FN=1; late warnings=1 | Detect changed outcomes or additional late warnings |
| Temporal ETA error | First-warning absolute-error p90=4.59 s | Fail if synthetic p90 exceeds documented 4.60 s tolerance |
| Adaptive A/B (14) | 151 pairs; constant mean error 0.509s; adaptive mean 0.525s; classification changes=0 | Keep constant-speed default; detect changed classifications or increased baseline ETA error |

These are **fixture regression tolerances**, not service-level objectives or real-world performance criteria. If the team intentionally changes a scenario or its label, update the gate in a separate reviewed commit with evidence; do not weaken checks merely to make them pass.

### Optional: live 25-car, 12-seed verification

Start the API separately with adaptive ETA OFF, using the same local developer operator credential configured in your frontend. Do not commit the credential:

```bash
EVRAS_ADAPTIVE_ETA=0 \
EVRAS_DEMO_OPERATOR_KEY='local-only-demo-secret-2026' pnpm dev:api
```

Then in another terminal:

```bash
cd ~/Projects/ev-ras
EVRAS_DEMO_OPERATOR_KEY='local-only-demo-secret-2026' \
  node scripts/final-regression.mjs --live
```

To additionally check the 11B validated manifest, only if its OSRM route geometry remains unchanged:

```bash
EVRAS_DEMO_OPERATOR_KEY='local-only-demo-secret-2026' \
  node scripts/final-regression.mjs --live \
  --manifest=demo-fixtures/traffic-validated.json
```

**Note:** the API cannot currently report which ETA flag it was started with. The runner can force the flag for its own child processes, but not for a separately started API server. You must start the API with `EVRAS_ADAPTIVE_ETA=0` to get a baseline live comparison.

The optional live report checks 12 seeds, 25 cars per seed, nonzero modeled alerts, complete created/cleared lifecycles, no active alerts at end, consistent per-seed totals, and ambulance route fingerprint. It does **not** call any of these physical traffic prediction accuracy.

If the live OSRM route hash has changed, a manifest verification failure is a valid detection of change, not a reason to bypass the verification.

## Commit after actual results pass

```bash
cd ~/Projects/ev-ras
git branch --show-current
git status -sb

git add scripts/final-regression.mjs \
  scripts/final-regression.test.mjs \
  scripts/lib/final-regression.mjs \
  scripts/lib/final-regression.test.mjs \
  README-15C.md

git diff --cached --check
git diff --cached --stat
```

Review the generated summary before adding it to Git. The JSON/Markdown reports contain no secrets by design, but are **measurements of your execution** and should be reviewed, not assumed valid:

```bash
cat demo-reports/final-regression/summary.md
# Optional, after review:
git add demo-reports/final-regression/summary.json demo-reports/final-regression/summary.md
```

Then:

```bash
git commit -m "test(release): add unified baseline detection regression gate"
git push -u origin test/final-regression-gate
```

Create/merge the PR at:
https://github.com/Olubakinde/ev-ras/compare/main...test/final-regression-gate

## After 15C

Go to deployment and end-to-end operational demo testing, including removing demo operator secrets from any public hosting configuration, restricting operator endpoints, validating WebSocket upgrades behind the deployment proxy, and documenting that EV-RAS remains a simulation rather than an actual emergency driver warning service.
