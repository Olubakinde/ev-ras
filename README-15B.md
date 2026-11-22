# EV-RAS — Milestone 15B: Experimental Adaptive ETA

**Purpose:** Try a bounded acceleration/trend ETA estimator without breaking the validated 25-car demo or silently declaring an improvement.

## Current baseline

The detector predicts time to a road point as distance ÷ instantaneous speed. It recomputes every simulation tick. The 12-case Milestone 14 fixture suite had 7 TP, 1 FP, 3 TN, 1 FN; first-warning absolute ETA error p90 4.59s and max 11.48s. Most first warnings occur before braking is observable, so no retrospective estimator can anticipate those speed changes. This is why 15B measures ongoing ETA *updates*, not just initial warnings.

## Implementation

- `apps/api/src/detection/domain/adaptive-eta.ts`: records three speed samples per vehicle, tests for a plausible consistent acceleration/braking trend, projects that trend for **at most 3 seconds**, then uses constant projected speed. Sudden changes, stale timestamps, fewer than three samples, and sign reversals revert to the existing constant-speed estimate. Stopping before a target returns null (unknown arrival).
- `apps/api/src/detection/domain/adaptive-eta.spec.ts`: 17 pure forecast and isolation regressions.
- `apps/api/src/detection/evaluation/adaptive-eta-evaluation.spec.ts`: 5 real-detector synthetic scenario regressions, including missing evidence and overpass isolation.
- `scripts/compare-eta-models.mjs`, `scripts/compare-eta-models.test.mjs`: compare the existing temporal cases plus two incremental speed-ramp cases in baseline and experimental mode; report paired update-time ETA errors **AND** any warning-classification changes. This cannot be used to claim real-world performance.
- `apply-15b.py`: guarded installer modifies exactly `encounter-detector.ts`, `demo-simulation.service.ts`, `temporal-evaluator.ts`; writes all files only when every required anchor exists. No original code is overwritten by the ZIP before the installer runs.

### Default is OFF

`EVRAS_ADAPTIVE_ETA` unset or `0` => **all previous behavior remains unchanged**. Seed 2028 demo and previously recorded warning/event timelines continue using the old estimator.

`EVRAS_ADAPTIVE_ETA=1` => candidate arrival estimates use the experimental recent-speed model. This can change detection eligibility, alert times, and seeded demo manifests. Do **not** claim old manifests are verified in this mode. This switch must NOT be used with live safety alerts.

There is **no auto-promotion** to default based on small synthetic tests. Compare results and inspect warnings individually first.

## Git prerequisites

Merge Milestone 15A to `main` first if it is complete; otherwise 15B can also be installed on the main branch that contains 14 because it changes separate files from 15A. Keep your feature branches linear.

```bash
cd ~/Projects/ev-ras
git switch main
git pull --ff-only origin main
git status -sb
git ls-files apps/api/src/detection/evaluation/temporal-evaluator.ts
git switch -c feat/adaptive-eta-evaluation
```

The previous command should display the temporal evaluator before you branch.

## Install

```bash
cd ~/Projects/ev-ras
unzip -o ~/Downloads/evras-milestone-15b.zip -d .
python3 apply-15b.py
```

## Tests

```bash
pnpm test:api
pnpm build:api
pnpm lint:api
pnpm test:web
pnpm typecheck:web
pnpm build:web
node --test scripts/compare-eta-models.test.mjs
```

Expect previous 284 API tests if 15A is merged, plus **22 new Vitest tests**. The 6 standalone CLI tests passed during packaging; full NestJS/Vitest validation must still be done in your repository. This target may change if your local main has other tests.

## Compare, without enabling the server flag

```bash
node scripts/compare-eta-models.mjs \
  --json=demo-reports/adaptive-eta-comparison.json \
  --md=demo-reports/adaptive-eta-comparison.md
cat demo-reports/adaptive-eta-comparison.md
```

This command imports the actual compiled detector and simulator, evaluates 14 synthetic trajectories twice (baseline and adaptive), and writes a report. No API server or OSRM needed. A lower matched-sample ETA error alone does not justify enabling 15B: inspect `classificationChanges` and potential missed encounters as well.

## Optional live 25-car smoke test

Run the existing demo WITHOUT the flag first. Then, in a separate test run, enable the experimental mode:

```bash
EVRAS_ADAPTIVE_ETA=1 EVRAS_DEMO_OPERATOR_KEY='local-only-demo-secret-2026' pnpm dev:api
pnpm dev:web
```

Both modes must be tested with the same seed and routing geometry if making a direct comparison. The existing validated manifest is for the baseline and is **not** a test oracle for experimental mode.

## Commit only after passing tests and reviewing the comparison

```bash
rm -f apply-15b.py

git branch --show-current
git status -sb

git add apps/api/src/detection/domain/adaptive-eta.ts \
  apps/api/src/detection/domain/adaptive-eta.spec.ts \
  apps/api/src/detection/domain/encounter-detector.ts \
  apps/api/src/detection/evaluation/adaptive-eta-evaluation.spec.ts \
  apps/api/src/detection/evaluation/temporal-evaluator.ts \
  apps/api/src/realtime/demo-simulation.service.ts \
  scripts/compare-eta-models.mjs \
  scripts/compare-eta-models.test.mjs \
  README-15B.md

git diff --cached --check
git diff --cached --stat

git commit -m "feat(detection): evaluate opt-in bounded adaptive ETA"
git push -u origin feat/adaptive-eta-evaluation
```

**Do not** commit a generated comparison report unless you have read it and it states all limitations clearly. Avoid claiming real-world safety improvement.
