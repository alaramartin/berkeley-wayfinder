# CLAUDE.md — Berkeley Wayfinder

Indoor wayfinding for UC Berkeley buildings, shown as a 3D building model with turn-by-turn directions. Floor geometry comes from photos of the directory placards posted in each building: a Python pipeline proposes a routing graph and room polygons, a local authoring tool lets a human correct and accept them, and a Next.js app on Vercel does routing and 3D display. **Wheeler Hall is the first building**; everything must generalize to more buildings through config, not code.

## Start every session here
1. Read the **Status** block at the top of `PLAN.md`. It says which milestone is active and what's blocked.
2. Work only on the current milestone's unchecked tasks, in order.
3. Check off each task in `PLAN.md` when its "done when" condition is verified, and update Status.
4. New or changed decisions go in the **Decision log** in `PLAN.md` (date, decision, why). Don't reopen logged decisions unless the user does.

## Workflow rules
- **One milestone at a time. Stop at each milestone's review gate.** End with a short summary: what was built, the exact commands to run, which files or screens to look at, and open questions. Don't start the next milestone until the user says so.
- **Confirm before outward-facing actions**: `gh repo create`, `git push`, Vercel linking or deploys, anything that publishes. Committing locally is fine.
- Verify before claiming done: run typecheck and tests, run the pipeline, look at debug overlays or screenshots. Report failures as they are.
- Prefer small commits per task, e.g. `m1: corridor skeleton graph`.

## Commands
```bash
pnpm install                              # all TS workspaces (Node >= 22.12, pnpm 10)
pnpm dev:nav                              # nav app  → http://localhost:3000
pnpm dev:author                           # author tool → http://localhost:3001 (local only)
pnpm typecheck                            # tsc across workspaces (TypeScript 7)
pnpm test                                 # vitest across workspaces
pnpm --filter @wf/nav build               # production build (what Vercel runs)
pnpm --filter @wf/schema gen:jsonschema   # regenerate packages/schema/schema/*.json. Commit the result; CI fails if stale

cd pipeline                               # Python 3.12 via uv
uv sync
uv run wf stages-list                     # which stages are implemented
uv run wf run wheeler --level L1                        # all implemented stages, one level
uv run wf run wheeler --level L1 --from-stage classify  # resume from a stage
uv run wf run wheeler                                   # all levels
uv run wf serve                                         # FastAPI on 127.0.0.1:8765 for the author tool
uv run pytest
uv run ruff check src tests
```
- Workspace packages are consumed as TS source (no build step); the Next apps list them in `transpilePackages`.
- Relative TS imports are extensionless (`./building`, not `./building.ts`).
- New pipeline stage: create `pipeline/src/wf/stages/<name>.py` with `@stage("<name>")`, import it at the bottom of `stages/__init__.py`, and add a test.

## Repo map
```
apps/nav/          public Next.js app (routes /, /[building], /field). Deployed to Vercel.
apps/author/       local-only Next.js desk tool. Reads/writes data/ via route handlers. NEVER deployed.
packages/schema/   zod schemas + types + generated JSON Schema. SINGLE SOURCE OF TRUTH for data shapes.
packages/geometry/ similarity transforms, polygon utils, ENU<->lat/lon. Pure.
packages/routing/  graph build, A*, nearest-POI, instructions. Pure TS (no DOM, no three).
pipeline/          Python 3.12 (uv). `wf` CLI stages: ingest → rectify → crop → classify → regions → graph → ocr → icons → connect → emit
data/raw/<b>/      source photos, config.yaml, golden.yaml                       (committed)
data/work/<b>/<l>/ intermediates: ingest.png, rectified.png, masks/, debug/     (gitignored)
                   corners.json, crop.json, proposal.json, review-queue.json, review-crops/ (committed)
data/buildings/<b>/ canonical data: building.json, levels/<l>.json, osm.json    (committed)
```

## Invariants (don't break these)
- **Schema first.** To change a data shape, edit `packages/schema` (zod), run `gen:jsonschema`, then update the Python pipeline and the apps. Python validates against the generated JSON Schema, never against hand-copied shapes.
- **Pipeline output is a proposal.** The pipeline writes only to `data/work/`. Only the author tool, through an explicit human accept, writes `data/buildings/`.
- **Coordinates:** `data/work` uses image pixels. `data/buildings` uses **meters in the building-local frame** (x east, y north, origin at footprint centroid). Convert with the level's `imageTransform`, never ad hoc.
- **Rooms** have a `polygon` (for rendering) and `doors` placed on corridor edges with `t` and `side` (for routing). Routing never goes through room polygons.
- **Low-confidence OCR or icon results go to `review-queue.json`**, never silently into the proposal.
- **Unverified stays flagged.** Auto-guessed doors, entrances, level M placement and default heights keep `verified:false` or `heightSource:"default"` until confirmed by a human or field patch.
- **Distances are approximate.** The UI says "about 30 m" and never implies precision.
- **Building-specific values live in `data/raw/<b>/config.yaml`**: level list, legend labels, heights, thresholds when they differ. No `if building === "wheeler"` in code.
- Stable readable IDs: `wheeler-L1-n012`, `wheeler-L1-e034`, `wheeler-L1-r150A`, `wheeler-shaft-s1`. Never renumber existing IDs; patches reference them.

## Conventions
- TypeScript `strict`, ESM, App Router, Tailwind, **Phosphor Icons** (`@phosphor-icons/react`), react-three-fiber + drei for 3D. Mobile-first layouts.
- Workspace package names: `@wf/schema`, `@wf/geometry`, `@wf/routing`.
- Tests live next to the code they test: `*.test.ts` (vitest), `pipeline/tests/` (pytest). Routing tests include real Wheeler data once it exists.
- Python: type hints, small pure functions per stage, and every stage writes a debug PNG to `data/work/<b>/<l>/debug/<stage>.png`. OpenCV does geometry, scikit-image does skeletonization, EasyOCR does text. No LLM APIs.
- Pipeline stages are re-runnable and resumable (`--from-stage`). Manual overrides (`corners.json`, `crop.json`) always beat auto-detection.
- Keep the author tool fast and keyboard-driven. It's used hundreds of times per building.

## Guardrails
- **No code or data from Dwinelle Navigator** (GPL-3.0). This project is MIT and written from scratch.
- Photos show placards and signage only, never people. Leave out labs, facilities plant and card-controlled areas.
- The author tool and pipeline are never deployed. Only `apps/nav` goes to Vercel.
- Don't add a backend, database or auth for v1. Field edits travel as exported patch files.
- Out of scope for v1: outdoor/inter-building routing, other buildings, live positioning. Note ideas in PLAN.md instead of building them.

## Domain notes
- Wheeler placards are **directory maps**: printed room numbers, a legend with category colors (green stairs, orange elevators, dark-blue restrooms, olive classrooms, maroon/purple offices, light-blue auditorium, red exit icons), and a left-side directory list that gives name→room aliases.
- Wheeler levels: **B, M, 1, 2, 3, 4**. M is a partial mezzanine with its own entrance, and its vertical position is **unverified**. Auditorium 150 is double-height (a void on L2).
- Floor heights default to ~4.5 m and get refined from stair step counts × 0.17 m.
- The sample L1 photo is at `data/raw/wheeler/wheeler-L1.heic` (originally `~/Downloads/IMG_8574.heic`). Its visible rooms are listed in `data/raw/wheeler/golden.yaml`.
