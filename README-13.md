# EV-RAS — Milestone 13: Labeled Synthetic Detection Evaluation

**Scope:** Synthetic, manually labeled route-intersection cases. This is an accuracy **unit benchmark**, NOT an estimate of real-world precision or recall.

## Contents

- `apps/api/src/detection/evaluation/labeled-scenarios.ts` — 17 independent, manually labeled cases with geometry, road node identities, expected alert boolean, and rationale.
- `apps/api/src/detection/evaluation/accuracy-evaluator.ts` — calls actual EV-RAS `detectEncounters` plus the Milestone 11A topology gate; builds confusion matrices and rates. Includes a geometry-only baseline for diagnostics.
- `apps/api/src/detection/evaluation/accuracy-evaluator.spec.ts` — 23 Vitest tests for labels, detector integration, and confusion-matrix edge cases.
- `scripts/evaluate-labeled-encounters.mjs` — command-line tool producing JSON and Markdown reports from compiled production TypeScript.
- `scripts/evaluate-labeled-encounters.test.mjs` — 3 Node CLI tests.

No existing source files are overwritten, no API endpoints change, no dependencies are added, and the frontend is untouched.

## Install

```bash
cd ~/Projects/ev-ras
# Ensure Milestone 12B was merged and your working directory is clean:
git switch main
git pull --ff-only origin main
git status -sb
git ls-files scripts/evaluate-traffic.mjs

# Only proceed if the file above is tracked and the working tree is clean.
git switch -c test/labeled-encounter-evaluation
unzip -o ~/Downloads/evras-milestone-13.zip -d .
```

## Validate

```bash
pnpm test:api
pnpm build:api
pnpm lint:api
node --test scripts/evaluate-labeled-encounters.test.mjs
pnpm test:web
pnpm typecheck:web
pnpm build:web
```

`pnpm test:api` should now include 23 new tests; the exact total depends on other changes in your branch. The extra 3 Node tests are independent of the NestJS test suite.

## Generate a genuine evaluation report

```bash
node scripts/evaluate-labeled-encounters.mjs \
  --json=demo-reports/labeled-accuracy.json \
  --md=demo-reports/labeled-accuracy.md
```

The runner loads the compiled TypeScript module in `apps/api/dist/detection/evaluation/accuracy-evaluator.js`. **Run `pnpm build:api` first.** It requires neither a running API nor OSRM access.

The report prints all TP / FP / TN / FN classifications and fixture precision / recall / F1. It intentionally has a separate section for incomplete OSM evidence: physically positive scenarios whose annotation is missing are counted as false negatives if the fail-closed detector withholds the warning.

### How to interpret results

- **TP:** Detector correctly warns for a manually labeled synthetic encounter.
- **FP:** Detector warns for a manually labeled non-encounter.
- **TN:** Detector does not warn for a manually labeled non-encounter.
- **FN:** Detector misses a manually labeled encounter (including abstaining because a needed node annotation is missing).
- **Geometric-only baseline:** Diagnostic output from `detectEncounters` without the road-evidence gate, included to measure the effect of gate filtering.
- **Precision / recall:** Defined **only within these 17 deliberately chosen cases**. Do not report these rates as real-world accuracy, a statistically representative sample, or proof of collision prevention.

Labels are hand-set BEFORE calling the detector, not inferred from its predictions. The tests explicitly invert one label while leaving the detector result unchanged to verify that separation.

## Git workflow

After tests pass and you've inspected `demo-reports/labeled-accuracy.md`:

```bash
cd ~/Projects/ev-ras
git branch --show-current
# Should be test/labeled-encounter-evaluation
git add apps/api/src/detection/evaluation/ \
  scripts/evaluate-labeled-encounters.mjs \
  scripts/evaluate-labeled-encounters.test.mjs \
  demo-reports/labeled-accuracy.md \
  demo-reports/labeled-accuracy.json

git diff --cached --check
git diff --cached --stat
git commit -m "test(detection): benchmark topology-aware warnings on labeled cases"
git push -u origin test/labeled-encounter-evaluation
```

Make a PR and merge after review. `README-13.md` can be kept as documentation or left untracked; no installer script is required.

## Why not label OSRM traffic observations automatically?

That would be circular: an auto-labeler built from the same road topology and ETA rules could reward the detector for agreeing with itself. This milestone uses intentionally small, independent synthetic scenarios. The next evaluation stage should add externally annotated road scenarios and actual-trajectory data, with explicit frame / topology labels, before reporting operational accuracy.
