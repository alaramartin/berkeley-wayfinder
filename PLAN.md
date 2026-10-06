# Berkeley Wayfinder — Plan

> **Source of truth for what to build and in what order.** Update the Status block and check off tasks as you go. Append new decisions to the Decision log instead of silently changing course.

## Milestones
- [x] **M0 — Scaffold** (done 2026-09-16)
- [x] **M1 — Pipeline** (done 2026-09-16)
- [x] **M2 — Authoring tool** (done 2026-09-24)
- [x] **M3 — Routing + complete Wheeler data** (done 2026-09-24)
- [ ] **M4 — Nav app + deploy** ← current
- [ ] **M5 — Field mode + verification walk**

## Status
- **Current milestone:** M4 — Nav app + deploy (app built and tested locally and pushed; **waiting on user** to approve the Vercel deploy and then the M4 review gate)
- **Last completed task:** M4 3D navigation + search polish (2026-10-06) — camera controller (drag moves the model in the screen plane, Shift/right-drag turns, two-finger swipe turns on phone and trackpad, pinch/wheel zoom), picking a room flies to it with a pin, L2 220/222/224 reclassified as classrooms (they were missing from search), pointer cursors; production live and auto-deploying from `main`
- **Previously:** M4 scene rounds 1–2 — mirror fix, floor ribbon, floor-change risers, guided camera, labels, legend; corridor straightening measured and declined
- **Vercel:** project `berkeley-wayfinder` (root `apps/nav`, team alara-martins-projects). Production deployed 2026-10-06 at https://berkeley-wayfinder.vercel.app, with Deployment Protection set to *all* deployments (the default "all except custom domains" left the production domain public), so only the owner's Vercel login opens it. GitHub is connected (2026-10-06): a push to `main` deploys to production, other branches get protected previews; manual deploys still work with `vercel deploy --prod` from the repo root
- **Blocked on user:** M4 review gate sign-off (hands-on check of the controls on a real phone; whether to make the site public); splitting the shared 220/222 room shape in the author tool
- **Previously:** M4 nav app: search, 3D scene, route panel, URL state
- **Previously:** M3 built — routing graph, A*, accessible mode, nearest-POI, instructions; 14 routing tests including real Wheeler data; `pnpm routes wheeler` prints samples
- **Previously:** M2 review gate passed — six levels accepted (188 rooms), aligned + OSM-fitted, 11 shafts (9 stairs, 2 elevators), 4 entrances; all canonical files validate
- **Blockers / waiting on user:** none
- **Next review gate:** end of M3, with sample routes printed as text to sanity-check

### M1 results (per level, before any human review)
| Level | Room numbers auto-accepted / found anywhere (golden) | Wrong accepts | Rooms | Stairs+elevators linked | Graph components | Entrance candidates | Review items |
|---|---|---|---|---|---|---|---|
| B | 83% / 88% (missing 22C, 31, 31A) | 0 | 25 | 8 | 3 | 1 | 6 |
| M | 100% / 100% | 0 | 11 | 5 | 1 | 0 | 0 |
| L1 | 92% / 92% (missing 130, 151) | 0 | 29 | 11 | 5 | 3 | 10 |
| L2 | 96% / 100% | 0 | 32 | 9 | 1 | 0 | 12 |
| L3 | 97% / 100% | 0 | 37 | 6 | 2 | 0 | 3 |
| L4 | 98% / 98% (missing 450) | 0 | 71 | 6 | 2 | 0 | 10 |

Overall: 174/183 room numbers auto-accepted (95%), 0 wrong. `uv run wf score wheeler` reproduces the numbers above.

---

## 1. Context
Google Maps has no indoor data for Berkeley, and OSM has about 34 indoor objects across the whole campus. Dwinelle Navigator (dkess.me/dwinelle) proves demand, but it covers one building and draws routes as abstract 3D lines. We're building a general indoor wayfinder whose main view is a **3D model of the building**. **Wheeler Hall** is first; the tooling must scale to most of campus (the next targets are the ~20 highest-traffic buildings: Evans, VLSB, Cory, Soda, Barrows, Doe, Dwinelle …).

Two apps come from one dataset:
1. **Capture & authoring**: turn placard photos into a routing graph plus 3D-ready geometry (Python pipeline + local desk tool + phone field mode).
2. **Navigation**: room-to-room directions shown as a 3D route plus a text step list.

### What the source photos actually are
Wheeler's photos are **directory placards**, not evacuation maps (sample: `~/Downloads/IMG_8574.heic`, "Directory Level 1"). That's better than the original brief assumed:
- **Room numbers are printed** inside rooms (100, 102 … 150A, 151 …).
- **Semantic colors with a legend on the board**: green = stairwells, orange = elevators, dark blue = restrooms, olive = general assignment classrooms, purple = College Writing Programs office, maroon = CWP faculty offices, light blue = Wheeler Auditorium, red icons = exits. Icons include a wheelchair (disabled access), DWA (designated waiting area) and an evacuation chair. There's also a purple "You are here" star.
- **Left panel**: an exploded 3D thumbnail of all levels plus a **directory list** ("English Dept. Main Office 322", "Berkeley Connect M13", "Disabled Students Program Office 22" …) that gives name→room aliases.
- **Levels: B, M, 1, 2, 3, 4.** M is a partial mezzanine with its own "Mezz. Entrance". The auditorium (150) is double-height (the L2 thumbnail shows an octagonal void).
- Noise to ignore: glare, photo perspective, the "You are here" star, dashed window marks on exterior walls, the left thumbnails (for geometry).

## 2. Decisions
| Topic | Decision |
|---|---|
| 3D view | **Exploded floor stack** by default, **toggle to solid dollhouse** at realistic elevations (animated transition; levels above focus are cut away) |
| Geometry source | **Automatic pipeline first** (Python: OpenCV + scikit-image). Output is always a *proposal* corrected in the desk authoring tool |
| OCR / icons | **Local only**: EasyOCR + legend color and template matching. High confidence → proposal. Low confidence → `review-queue.json` → review UI in the author tool. **No Claude/LLM API** |
| Floor alignment | 2–3 clicked anchor pairs (stairwell corners) per level → similarity transform to L1. L1 fit once to Wheeler's **OSM footprint** → building-local meters + lat/lon origin |
| Doors | Auto-guessed where a room wall faces the nearest corridor, `verified:false`, confirmed on a **verification walk** |
| Heights | Default ~4.5 m per floor (M halfway). Refined from **stair step counts** on the walk (steps × 0.17 m) |
| v1 scope | **Complete Wheeler nav app, all levels.** Extras in scope: building entrances as start/end, nearest restroom/elevator, shareable route URLs, search by name (not just number) |
| Out of scope for v1 | Outdoor legs between buildings, other buildings, blue-dot positioning, auto-deploying the author tool |
| Platform | Mobile-first web: Next.js (App Router) + TypeScript + Tailwind + Phosphor Icons + react-three-fiber/drei |
| Licensing | Original code, **MIT**. **No code or data from Dwinelle Navigator** (GPL-3.0). Not contacting its author for now |
| Repo / hosting | **Public GitHub repo**, **Vercel** deploys `apps/nav` only (includes `/field`). Author tool and pipeline are **local-only** |
| Field sync | `/field` works offline, edits go to IndexedDB, **export a patch JSON** → import and review in the author tool. No backend |
| Workflow | Build **one milestone at a time; stop for user review after each** |

## 3. Repo layout
pnpm workspaces (TS) + uv (Python).
```
apps/nav/                    Next.js — public nav app + /field  (Vercel project root)
apps/author/                 Next.js — local desk authoring tool; route handlers read/write data/
packages/schema/             zod schemas + TS types + generated JSON Schema (schema/*.json) for Python
packages/routing/            pure TS: graph build, A*, nearest-POI, instructions (vitest)
packages/geometry/           similarity transform fit (Umeyama), polygon utils, local ENU <-> lat/lon
pipeline/                    Python 3.12 (uv): CLI `wf`, FastAPI `wf serve` (localhost:8765)
data/raw/<building>/         source photos + config.yaml + golden.yaml       (committed)
data/work/<building>/<lvl>/  ingest.png, rectified.png, masks/, debug/        (gitignored)
                             corners.json, crop.json, proposal.json, review-queue.json, review-crops/ (committed)
data/buildings/<building>/   canonical accepted data: building.json, levels/<lvl>.json, osm.json  (committed)
```
Raw HEICs are about 2.5 MB each, so a building is about 15 MB. Plain git is fine for now; move to LFS once past ~20 buildings.

### `data/raw/wheeler/config.yaml` (initial)
```yaml
id: wheeler
name: Wheeler Hall
aliases: [Wheeler]
osmWayId: null          # look up via Overpass in M2
defaultFloorHeightM: 4.5
levels:                 # order from placard list; M position UNVERIFIED
  - { id: B,  displayName: "B", sortIndex: 0, photo: wheeler-B.heic }
  - { id: M,  displayName: "M", sortIndex: 1, photo: wheeler-M.heic, verified: false }
  - { id: L1, displayName: "1", sortIndex: 2, photo: wheeler-L1.heic }
  - { id: L2, displayName: "2", sortIndex: 3, photo: wheeler-L2.heic }
  - { id: L3, displayName: "3", sortIndex: 4, photo: wheeler-L3.heic }
  - { id: L4, displayName: "4", sortIndex: 5, photo: wheeler-L4.heic }
legend:                 # class -> placard legend label (swatch located in legend panel)
  stair: "Stairwells"
  elevator: "Elevators"
  restroom: "Restrooms"
  classroom: "General Assignment Classrooms"
  office: ["College Writing Programs Office", "College Writing Programs - Faculty Offices"]
  auditorium: "Cal Performances - Wheeler Auditorium"
```

## 4. Data schema (`packages/schema`)
Adapted from the brief with two changes: **rooms have polygons** (the 3D view needs them) and **canonical coordinates are meters in the building-local frame** (x east, y north, origin at footprint centroid). The key idea is kept: **routing reaches a room through a door located along a corridor edge.**

```ts
Building { id, name, aliases[], osmWayId|null, origin{lat,lon}|null, footprint: [x,y][], levels: LevelRef[] }
Level    { id, buildingId, sortIndex, displayName, elevationM, heightM,
           heightSource: "default"|"stair-count"|"measured", verified,
           outline: [x,y][], voids: [x,y][][], imageTransform: Similarity /* px -> m */ }
Node     { id, levelId, x, y, kind: "junction"|"door"|"stair"|"elevator"|"entrance", verified }
Edge     { id, a, b, kind: "corridor"|"stair"|"elevator"|"outdoor", polyline?: [x,y][],
           accessible, access: "open"|"card"|"hours"|"locked", verified }
Room     { id, number, name?, aliases[], category: "classroom"|"office"|"restroom"|"auditorium"|"stair"|"elevator"|"other",
           levelId, polygon: [x,y][], doors: { edgeId, t /*0..1*/, side: "left"|"right", verified }[],
           restroom?: { gender: "men"|"women"|"all", accessible } }
Shaft    { id, kind: "stair"|"elevator", name?, nodeIds[] /* ordered by level */, stepCounts?: number[] }
Entrance { id, nodeId, name, accessible, verified }
Poi      { id, kind: "restroom"|"accessible-restroom"|"elevator"|"evac-chair"|"dwa"|"exit", levelId, nodeId?, roomId? }
Patch    { buildingId, baseHash, createdAt, author?, ops: PatchOp[] }
PatchOp  = confirmDoor | moveDoor | setRoomNumber | setEdgeAccess | setStepCount | confirmEntrance | note
```
- IDs are stable and readable: `wheeler-L1-n012`, `wheeler-L1-e034`, `wheeler-L1-r150A`, `wheeler-shaft-s1`.
- `proposal.json` uses the same shapes but **image-pixel** coordinates plus `confidence` fields, wrapped as `Proposal { buildingId, levelId, imageSize, rooms, nodes, edges, icons, outline }`.
- `packages/schema` exports JSON Schema to `packages/schema/schema/*.json`; the Python pipeline validates its output against those files.

## 5. Pipeline (`pipeline/`)
CLI: `uv run wf run <building> [--level L1] [--from-stage rectify] [--to-stage ocr]`. Each stage reads the previous stage's outputs from `data/work/…`, writes its own, and writes a **debug overlay PNG**.

1. **ingest**: HEIC→PNG (pillow-heif), apply EXIF orientation, downscale the long edge to ≤ 4000 px.
2. **rectify**: find the placard quad (grayscale → blur → Canny → dilate → largest convex 4-point `approxPolyDP`, area > 20% of the image) → `getPerspectiveTransform`/`warpPerspective` to a fixed width (e.g. 3000 px, aspect from the quad side lengths). `corners.json` overrides auto-detect.
3. **crop**: find the **plan panel** (largest region enclosed by the thick orange/black outline) and the **legend panel** (below the plan: swatches + labels) and **directory panel** (left). `crop.json` overrides.
4. **classify**: locate legend swatches (colored squares left of text) → sample the median LAB color per class, plus fixed classes: corridor (near-white inside outline), wall (dark gray/black), exterior band (orange), background. Nearest-centroid classification in LAB with a distance cutoff → `unknown`. Output: masks per class.
5. **regions**: per class, connected components → contours → `approxPolyDP` → snap edges to the two dominant axes (Hough/angle histogram) → room/stair/elevator/restroom polygons; building outline = outer contour of wall + exterior band.
6. **corridor graph**: corridor mask ∩ inside the outline, morphological close to fill text/icon holes → `skimage.morphology.skeletonize` → prune spurs < ~25 px → nodes = pixels with ≥3 neighbors (junctions) or 1 neighbor (endpoints) → trace pixel paths between nodes → RDP simplify → edges with polylines. Cluster junction pixels within a few px into one node.
7. **ocr**: EasyOCR on each room polygon's bounding crop (try 0° and 90° rotations), regex `^[BM]?\d{1,3}[A-Z]?$`. Confidence ≥ 0.8 plus a regex match → set `number`. Otherwise → `review-queue.json` item `{id, kind:"room-number", crop, candidates[], polygonRef}`. Directory panel OCR: lines matching `<name> <room>` → aliases (all go to review unless ≥ 0.9).
8. **icons**: cut templates from the legend icons (exit, wheelchair, DWA, evac chair) → multi-scale `matchTemplate` on the plan → NMS. Exit icons near the outline become `entrance` candidates. Scores < threshold → review queue.
9. **connect**: for each room, find its wall segment nearest to a corridor edge → door at the projection (`edgeId`, `t`, `side`, `verified:false`). Stair/elevator polygons → a `stair`/`elevator` node at the centroid linked to the nearest corridor node. Restrooms get gender from icon/OCR when possible, otherwise review.
10. **emit**: `proposal.json` (validated against the JSON Schema) + `debug/summary.png` (everything drawn on the rectified image).

`wf serve`: FastAPI with `POST /run {building, level, fromStage}`, `GET /status`, serving `data/work` images. Used by the author tool after corner/crop edits.

**Golden check**: `data/raw/wheeler/golden.yaml` lists the room numbers visible on each placard. L1 from the sample: `100 102 104 105 106 107 108 110 111 112 113 114 115 116 117 118 119 120 122 123 124 126 130 150 150A 151`, plus counts of stairs, elevators and restrooms. `pytest` reports recall/precision and asserts the corridor graph is one connected component.

## 6. Authoring tool (`apps/author`, local only, keyboard-first)
- **Building overview**: levels, pipeline status per level, review-queue counts, and validation errors.
- **Rectify/crop step**: drag the 4 corners and the crop rectangles on the original photo → save `corners.json`/`crop.json` → `POST wf serve /run`.
- **Level editor**: rectified image underlay + proposal overlay (SVG, pan/zoom). Layers: rooms, corridors, nodes, doors, icons. Tools: `V` select/move, `N` node, `E` edge, `D` door, `R` room polygon, `Del` delete, `⌘Z/⇧⌘Z` undo/redo, `L` label room. Autosaves `proposal.json`.
- **Review queue** (`/review`): one card at a time with crop + candidates. `Enter` accepts the top candidate, typing corrects, `Tab` skips, `X` marks "not a room". Writes answers back into the proposal.
- **Accept level**: proposal → canonical `levels/<id>.json` via `imageTransform` (px → m); schema-validated; refuses while validation errors remain.
- **Align**: onion-skin a level over L1; click anchor pairs → least-squares similarity (`packages/geometry`); show residuals.
- **OSM fit**: Overpass query for Wheeler's building way (cached in `osm.json`); click placard outline corners ↔ footprint vertices → L1 transform to local meters; store `origin` lat/lon.
- **Shafts**: propose stair/elevator nodes on adjacent levels within ~3 m (after alignment) → confirm/reject → `Shaft` + vertical `stair`/`elevator` edges. Edit level `elevationM`/`heightM`, step counts → recompute elevations.
- **Patch import**: load a field patch → diff list (per op: before/after) → accept/reject → write canonical files. Warn when `baseHash` doesn't match.

## 7. Routing (`packages/routing`, pure TS, no DOM/three)
- `buildGraph(building, levels)`: nodes/edges with 3D positions (x, y, elevationM). Corridor edge length from the polyline. Room doors become virtual nodes that split their edge at `t` (on demand).
- `route(graph, from, to, {accessible})`: A* with a 3D Euclidean heuristic divided by walking speed. Cost is in seconds: walk 1.3 m/s; stair ≈ 12 s per level + vertical distance / 0.4 m/s; elevator 45 s wait + 5 s per level. Accessible excludes `stair` edges and non-accessible entrances. Edges with `access: "locked"` are always excluded; `card` is excluded by default.
- `nearest(graph, from, poiKind, opts)`: Dijkstra until the first POI of that kind.
- `instructions(path, context)`: turn classes from the bearing change (straight < 30°, slight 30–60°, turn 60–135°, sharp > 135°), merge straight runs, landmark anchoring (rooms passed with door on left/right, stairwells, restrooms, auditorium), vertical steps ("Take the stairs up to Level 3"), approximate distances ("about 30 m", rounded to 5 m), total walking time.
- Endpoints: `{type:"room", id} | {type:"entrance", id} | {type:"node", id}`.

## 8. Nav app (`apps/nav`)
- `/`: building picker (Wheeler only). `/[building]?from=120&to=315&accessible=1&view=exploded|solid`: all state is in the URL, so links are shareable.
- **Search**: fuse.js over room numbers ("120", "Wheeler 120"), names/aliases ("English Dept. Main Office", "Wheeler Auditorium", "Berkeley Connect"), entrances ("Mezzanine entrance"), special queries ("nearest restroom", "nearest accessible restroom", "nearest elevator"; these need a `from`).
- **3D scene** (r3f + drei), meshes generated from level JSON:
  - Level slab (ExtrudeGeometry from outline minus voids), rooms as low extruded blocks in placard category colors, low perimeter walls, room number labels (`Text`, hidden beyond a camera distance), stair/elevator blocks.
  - **Exploded** y = `sortIndex × explodeGap`; **Solid** y = `elevationM`, levels above the focused one hidden or ghosted. Animated spring between the two.
  - Route: animated tube/dashed line, vertical segments through shafts, start/end pins. Non-route levels fade.
  - Orbit controls, tap a level to focus, auto-fit the camera to the route. Merge geometry per level; target smooth performance on mid-range phones.
- **UI**: mobile bottom sheet (from/to fields, accessible toggle, view toggle, step list, time estimate). Tapping a step focuses its level/segment. Desktop: side panel.
- **Data loading**: building JSON is bundled at build time (static import / generated into `apps/nav/public/data`). No backend.
- **`/field`** (M5): service worker for offline use, IndexedDB edits, 2D level plan, lists of unverified doors/entrances, confirm/move door, fix room number, mark access (card/locked/hours), step counts per flight, export patch (Web Share API → download fallback).

## 9. Milestones & tasks
Each milestone ends with a **review gate**: stop, summarize what was built, list exactly what the user should run and look at, and wait.

### M0 — Scaffold ✅
- [x] `git init`, `.gitignore` (node_modules, .next, .venv, `data/work/**/{ingest.png,rectified.png,masks,debug}`), MIT `LICENSE`, README stub. *Done when:* `git status` is clean after the first commit.
- [x] pnpm workspace root (`pnpm-workspace.yaml`, root `package.json` scripts: `dev:nav`, `dev:author`, `build`, `typecheck`, `test`), shared `tsconfig.base.json` (strict). *Done when:* `pnpm install` succeeds.
- [x] `packages/schema`: zod schemas from §4, inferred types, `gen:jsonschema` script writing `schema/*.json`, round-trip tests. *Done when:* `pnpm --filter @wf/schema test` passes.
- [x] `packages/geometry`: similarity fit (Umeyama), apply/invert, polygon area/centroid/point-in-polygon, ENU↔lat/lon; tests. *Done when:* tests pass.
- [x] `packages/routing`: package skeleton + one placeholder test (real work in M3).
- [x] `apps/nav` and `apps/author`: Next.js + Tailwind + Phosphor skeletons with a hello page each. *Done when:* both dev servers start.
- [x] `pipeline/`: uv project (Python 3.12; opencv-python-headless, scikit-image, numpy, pillow, pillow-heif, shapely, easyocr, fastapi, uvicorn, typer, pyyaml, jsonschema, pytest), `wf` CLI with a stage registry and `ingest` stage implemented. *Done when:* `uv run wf run wheeler --level L1 --to-stage ingest` produces `ingest.png` from the sample.
- [x] `data/raw/wheeler/config.yaml` (§3), `golden.yaml` (L1 from sample), sample photo copied as `wheeler-L1.heic`.
- [x] GitHub Actions CI: pnpm typecheck + test, uv pytest. (The workflow file only; the repo gets pushed after confirming with the user.)
- [x] CLAUDE.md commands section verified against reality.
- [x] **Review gate M0.** Photos added, repo created and pushed.

### M1 — Pipeline ✅
- [x] **Placard findings from the real photos:**
  - [x] Legends differ per placard → legend read per placard (swatches + OCR'd labels → category via generic keyword rules; `categoryRules` in config for overrides). Works on all 6.
  - [ ] Placards aren't all drawn the same way up → **moved to M2**: alignment allows any rotation; author tool needs 90° rotate buttons before anchor picking.
  - [x] L4 cut off → line-search quad on board-parallel lines + grow-to-board in rectified space; `corners.json` override still available.
  - [x] M's tiny plan → crop picks the largest ink blob between rules, independent of size.
  - [x] Gender-inclusive restroom + lactation room added to the schema.
  - [x] Small labels → zoomed second OCR pass; leftovers go to review.
  - [ ] M sits over L1's west wing? → verify in M2 alignment + walk.
- [x] `golden.yaml` for every level.
- [x] rectify (auto + `corners.json` override). All 6 flat; aspect from EXIF focal length agrees across same-size placards (0.641–0.648).
- [x] crop plan/legend/directory panels (auto; `crop.json` with `"source": "manual"` is kept).
- [x] classify from legend swatches. Neutral classes (paper, light/dark gray, wall) refined per plan.
- [x] regions → room polygons (axis-snapped), outline, voids (disk opening), corridor mask (glare, facade-strip and courtyard-corner filters).
- [x] corridor skeleton → graph. *Done-when not fully met:* L1 is 5 components (main ring 33 nodes + east-lobby/stair fragments); M and L2 are single components. Remaining joins are author-tool work.
- [x] OCR room numbers (two passes, per-level `roomPattern`, duplicate guard) + directory aliases (L1: all 9 pairs correct).
- [x] icons: strong template matches only (accessible, DWA, evac chair, gender-inclusive) + exit signs by color. Star detection dropped (confused with dark purple fills). **Weakest stage**; entrances rely mostly on exit signs / corridor dead-ends.
- [x] door + vertical connector + entrance proposals.
- [x] emit `proposal.json` + `review-queue.json` (both schema-validated) + `debug/summary.png`.
- [x] golden check in pytest (`test_wheeler_room_number_scores`, skipped when outputs are absent, e.g. CI).
- [x] run on every level; results in the Status block.
- [x] **Review gate M1.** Approved by user 2026-09-16; pushed.

**Known proposal defects for M2 to fix by hand** (the authoring tool must make these fast):
- Suites merged into one polygon (L3 319/320/322/323 block; B 22/23 block; L4 east column 401–410). One room per number shares the polygon, so they need splitting.
- Restrooms have no numbers. Name them from gender (review queue) + level.
- L1 graph fragments around the east lobby and the NW/SW stairs need joining. B's main corridor is broken at the you-are-here star.
- Few entrances detected (B: 1, L1: 3, others: 0). Upper floors correctly have none, but B/L1/M entrances need confirming or adding.
- L4 outline includes the glare wedge on the photo's left edge.
- L2 has 4 low-score "DWA" icon matches in review that are window dashes.

### M2 — Authoring tool ✅
Design (decided at M2 start, see Decision log):
- **Hand edits are never clobbered.** Once the tool saves a proposal it sets `editedAt`. After that, `emit` writes `proposal.auto.json` instead, and the tool offers "compare / reset from pipeline".
- **Workflow per building:** fix each level in pixel space (editor + review queue) → align every level to the reference level (L1) → fit L1 to the OSM footprint → accept all levels (px → meters) → link shafts and set heights on canonical data.
- **`data/work/<b>/alignment.json`** (committed) holds per-level anchor pairs + transform to reference pixels, plus the OSM fit (anchor pairs, transform, lat/lon origin, way id).
- **px → meters:** `imageTransform` is a similarity applied to `(x, −y)`, since image y points down and world y points up. Helper in `@wf/geometry`.
- **Canonical rooms may lack a number** (restrooms) but must then have a `name`. Accept is blocked while review items are unresolved or a level has more than one graph component (unless the extra pieces are explicitly allowed).
- Pure logic (review application, accept conversion, polygon split, shaft proposals, graph checks) lives in `apps/author/lib/` with vitest tests. UI state is a history stack of proposal snapshots (undo/redo), autosaved.

Tasks:
- [x] Schema: `editedAt`, `regionId`, `labelAt`, `restroom`, entrance `name`; canonical `Room.number` nullable with a name rule; `Alignment` schema; config `referenceLevel` + per-level `elevationM`; emit writes `proposal.auto.json` when edited.
- [x] Data API route handlers (buildings, proposal, review, files, run proxy, reset, corners, alignment, OSM fetch, accept, canonical). Path-traversal safe; typed 400/404 errors.
- [x] `wf serve`: `POST /run`, `GET /status`; `WF_DATA_DIR` lets it run against a scratch copy.
- [x] Building overview page (per-level rooms, review progress, corridor pieces, blockers, aligned/accepted).
- [x] Level editor: pan/zoom over the placard photo; select/move nodes; add, split and delete nodes and corridors; room inspector (number, name, category, restroom, doors); label-aware suite split; draw room; door placement; entrance marking; undo/redo; autosave; corridor-piece list; blockers. *Verified in browser:* joined an L1 fragment, split the 111–119 suite (rooms landed on the correct halves), undo.
- [x] Review queue UI (Enter accept, typing corrects, Tab skip, ⇧Enter reject; W/M/A for restrooms). Duplicate numbers are refused with an explanation instead of being silently ignored. *Verified in browser* on L1.
- [x] Corners page (drag 4 corners → `corners.json` → re-run from rectify). *Verified* via API on scratch (L4 re-ran in ~34 s).
- [x] Align page: auto-align (ICP from 4 quarter-turn starts; close alternatives offered), ±90° rotate, click anchor pairs with residuals, onion skin, stair/elevator overlap markers. *Verified:* B auto-aligned; M aligned by 2 anchors over L1's west wing.
- [x] OSM page: Overpass fetch (Wheeler = way 1410826203) + cache, auto-fit + alternatives, anchors snapping to footprint vertices. *Verified:* L1 fits at 0.048 m/px, 0.9 m error.
- [x] Accept: proposals → `building.json` + `levels/<id>.json` (schema-validated), directory aliases applied across levels, entrances carried over, existing shafts kept.
- [x] Shafts & heights page: proposes stair/elevator chains (skipping a partial level), plan view of all levels, editable elevations/heights. *Verified* on scratch (8 shafts saved).
- [x] Tests: author lib 12 (graph edits, split assignment, review answers, accept, shafts, alignment), geometry 9, schema 8, pipeline 22. Typecheck, lint and author build are clean.
- [x] **Review gate M2.** Wheeler reviewed and accepted by the user (2026-09-24): all six levels accepted, aligned and OSM-fitted, 11 shafts saved.

#### M2 review: how to do it
Run these in two terminals, then open http://localhost:3001/b/wheeler
```bash
pnpm dev:author                      # the tool
cd pipeline && uv run wf serve       # only needed for the Corners page (re-running the pipeline)
```
1. **Per level, Review first** (Review link): answer every card. Merged restrooms (e.g. L1 women+men in one outline): press Tab to skip, split them in the editor, then come back.
2. **Per level, then Edit** until the sidebar says "Ready to accept":
   - **Merged suites:** select → **Auto-split along the printed walls** in the inspector (needs `wf serve`), which cuts the suite into one room per printed number. For a room whose number you typed yourself, the tool asks you to click where it is. Fall back to **S** → click a line between two numbers. Each room keeps the half its number is printed in. Known cases: L1 west wing 110–119, L1 north row 102/104/106, L3 319/320/322/323, B 22/23, L4 east column.
   - **Corridor pieces:** use **E** to click from a piece's end node to the main corridor. Delete fake spurs with Delete.
   - **Rooms without a number:** type it in the inspector, give it a name (restrooms get one from their gender), or delete it if it isn't a room.
   - **Doors:** select a room → **D** → click the corridor at its real door (guesses are yellow squares).
   - **Entrances:** select the node where a corridor meets an outside door → **X**, give it a name, and tick "accessible" if step-free.
3. **Align** (overview → Open alignment): Auto-align B, L2, L3, L4 and check that the stair squares sit on the stair circles. M needs anchors: click an M stairwell on the overlay, then the matching L1 stairwell, twice. The auto result for M is wrong on purpose (partial floor).
4. **OSM fit:** Auto-fit, then **check orientation**. Wheeler's footprint is nearly symmetric, and the 270° fit (0.90 m) barely beats the 90° one (0.97 m). Pick the one that puts the colonnade/main entrance on the correct side of the building.
5. **Accept all ready levels** on the overview, then **Shafts & heights**: Propose, untick wrong links, Save.
If something looks wrong in the photo-to-plan conversion itself, use Corners (needs `wf serve`).

### M3 — Routing + complete Wheeler data ✅
- [x] graph build with virtual door nodes (`packages/routing/src/graph.ts`): doors split their corridor edge at `t`, rooms get a node reached through their doors, shafts become vertical edges.
- [x] A* + accessible mode + access filtering (`route.ts`). Costs in seconds; `locked` always excluded, `card` opt-in.
- [x] nearest-POI (`nearest.ts`). Asking for a restroom also matches accessible and all-gender ones.
- [x] instruction generation with landmarks (`instructions.ts`). Legs are simplified (RDP, 2 m) before turns are read, so skeleton wobble doesn't become a turn; flights in one shaft merge into a single step.
- [x] tests on fixtures and **real Wheeler data**: same-floor, multi-floor, accessible (must use the elevator), entrance→room, nearest restroom, unreachable → clear error. 14 tests.
- [x] all Wheeler levels accepted, aligned, shafts linked; the building validates end to end.
- [x] instructions mention `enteredVia` ("room 31A is inside 31").
- [x] `pnpm routes wheeler` prints sample routes as text (`--from`/`--to`/`--accessible`).
- **Review gate M3.** Print sample routes as text for the user to sanity-check.

### M4 — Nav app + deploy
- [x] data bundling from `data/buildings` (`apps/nav/scripts/bundle-data.mts` → `public/data`, runs before dev/build/test; gitignored).
- [x] search (numbers, names, aliases, entrances, nearest-X) with fuse.js; service rooms excluded.
- [x] 3D scene: level slabs (outline minus voids), room blocks merged per colour, billboard labels, exploded layout.
- [x] solid dollhouse mode + animated toggle + cutaway (levels above the focus, or above the route's top level, are hidden).
- [x] route rendering (animated dashed line, start/end pins) + camera fit + level focus.
- [x] bottom sheet (phone) / side panel (desktop) with steps, time, step-free toggle; tapping a step focuses its level.
- [x] URL state (shareable links): `from`, `to`, `nearest`, `accessible`, `view`, `level`.
- [x] phone-width checks + performance pass: layout verified at ~500 px and desktop. (fps readings on this machine are capped at ~31 by the browser — a plain HTML page reports the same, so it is not the scene.)
- [x] **Scene rework after review** (2026-09-25): fixed the mirrored building, replaced the floating dashed line with a floor ribbon, freed the camera and added a guided fly-in, put labels on rooms, added a legend. Detail in the Decision log.
- [x] **Corridor centrelines: measured, and deliberately left alone** (2026-09-29). See the Decision log.
- [ ] ~~Corridor centrelines still bow~~ (L4's trunk 38.9 m along a 34.0 m chord; L1 `e026` sags 6.7 m). Visible as the ribbon drifting diagonally across a straight corridor. Decision pending — see Decision log 2026-09-24 for the agreed shape of the fix.
- [ ] **confirm with user**, then create the Vercel project (root `apps/nav`) and deploy.
- **Review gate M4.** Share the deployed URL + test routes.

### M5 — Field mode + verification walk
- [ ] `/field` offline shell (service worker, IndexedDB).
- [ ] door confirm/move, room number fix, access flags, step counts, entrance confirm.
- [ ] patch export (share sheet / download).
- [ ] author-tool patch import with diff review.
- [ ] elevation recompute from step counts; resolve Level M placement.
- [ ] **User does the walk** → import → redeploy.
- **Review gate M5.** Wheeler v1 done.

## 10. Verification (end to end)
- `pnpm -r typecheck && pnpm -r test`: schema round-trips, geometry, routing on fixtures + real Wheeler data.
- `uv run pytest` in `pipeline/`: stage tests on the sample photo; golden recall ≥ 90% on L1.
- `uv run wf run wheeler --level L1`, then inspect `data/work/wheeler/L1/debug/*.png`.
- Author tool: clear the L1 review queue, accept, align L2 → L1, confirm shafts, every level validates.
- Nav app (run skill / Chrome automation at phone width): route 120 → 315 (multi-floor via stairs); same with accessible=1 (must use the elevator); "nearest restroom" from 150; entrance → 322; a share link reloads the identical route; exploded ↔ solid toggle.
- After M5: importing a sample patch flips door `verified` flags and updates level elevations.

## 11. Open questions / verify on walk
- [ ] **Level M**: actual vertical position and elevation. Initial guess: placard list order. *M2 finding:* aligning by stairwells puts M's office strip exactly over L1's west wing (110–119, also College Writing Programs) and M's elevator on L1's, so M is a mezzanine over the west wing. Height still unverified.
- [x] Levels beyond B–4? Photos cover B, M, 1, 2, 3, 4 only.
- [ ] Door locations for every room (esp. large rooms: 150 auditorium, 100, 130).
- [ ] Locked, card-only or hours-restricted doors and entrances.
- [ ] Real floor-to-floor heights (step counts per flight, per shaft).
- [ ] Which entrances are accessible (placard wheelchair icons suggest the east side on L1; verify).
- [ ] Wheeler's OSM way ID (look up in M2).

## 12. Decision log
| Date | Decision | Why |
|---|---|---|
| 2026-10-06 | A two-finger swipe turns the model on a trackpad too, as on a phone (pinch and the mouse wheel zoom). The on-screen Move/Turn toggle was built and removed the same day | The user disliked the toggle and asked for two-finger swipe = rotate everywhere; plain drag still moves, Shift/right-drag still turns |
| 2026-10-06 | Mouse matches maps: plain left-drag grabs the model and moves it in the screen's plane (the grabbed spot stays under the cursor; dragging down brings higher levels into view). A floor-plane pan was tried and reverted the same day: it can never reach another level of the exploded stack. Shift-drag or right/middle-drag turns and tips. Trackpad two-finger swipe moves the same way; pinch and wheel zoom | Researched Mapbox, Google Earth/Maps 3D, three.js MapControls and Mappedin: all make plain drag pan and put rotate on right-drag or Ctrl/Shift-drag. Left-drag-to-rotate (Sketchfab style) made crossing a floor a chore because panning needed an undiscoverable modifier |
| 2026-10-05 | Touch scheme set by the user: one finger slides, two fingers swipe to turn and pinch to zoom (twist does nothing). Mouse keeps left-drag turn, right/Shift-drag slide, wheel zoom; trackpad pinch zooms and two-finger swipe slides | The user's explicit preference after trying the Sketchfab-style scheme on a phone |
| 2026-10-05 | Orbit pivots on the surface at the middle of the screen (blended to the building's centre when zoomed out); tilt the limits refuse becomes a vertical slide instead of going dead | Auto-recentre was tried and removed (2026-10-05): the camera must only move when the user moves it. Model-viewer, Matterport, Cesium, Babylon and three all pivot on the view centre so nothing swings sideways. The earlier off-axis pivot made the model drift off-screen and a level view stopped responding to drag-up |
| 2026-09-30 | One custom camera controller (`lib/controller.ts`) replaces OrbitControls and our extra handlers. One finger/left mouse turns; two fingers pinch, twist and slide together; right/Shift-drag slides; wheel and trackpad swipe zoom to the cursor; double-tap zooms; flings coast. Zoom and pinch hold the real surface under the fingers (raycast). No shadows; labels mount once and toggle visibility. Canvas is `user-select:none; touch-action:none` | Two handlers on one canvas fought over touches and left the camera dead until all fingers lifted ("stuck"); modelled on Sketchfab/Matterport/Google Maps. Trackpad swipe now zooms instead of panning, which the reference viewers do; the mouse/trackpad override is gone |
| 2026-09-16 | Photos are directory placards; rely on printed room numbers + legend colors | Better source than evac maps; removes the "room numbers missing" gap |
| 2026-09-16 | Rooms are polygons + doors on corridor edges | 3D view needs polygons; routing stays topological via doors |
| 2026-09-16 | Canonical coords in building-local meters; px only in `data/work` | One frame for all levels; OSM fit gives real-world placement |
| 2026-09-16 | Auto pipeline first, human-accepted proposals | User choice; never silently trust extraction |
| 2026-09-16 | Local OCR only; low confidence → review queue UI | User choice; no API key/cost |
| 2026-09-16 | Exploded default + solid dollhouse toggle | User choice |
| 2026-09-16 | MIT, no Dwinelle Navigator code/data, author not contacted | User choice; avoids GPL |
| 2026-09-16 | Public GitHub + Vercel (nav + /field only); author tool & pipeline local | User choice |
| 2026-09-16 | Field edits offline → exported patch JSON → reviewed import | No backend, no secrets |
| 2026-09-16 | Level M order = placard list (B, M, 1, 2, 3, 4), unverified | Ambiguous placard; settle via step counts |
| 2026-09-16 | One milestone at a time with a review gate | User choice |
| 2026-09-16 | Legend read per placard; building config holds only optional `categoryRules` | Every Wheeler placard has a different legend |
| 2026-09-16 | Rectify via line-search quad + grow-to-board; aspect from EXIF focal length (Zhang & He) | Color thresholds failed on bright walls; L4 is cut off; focal aspect is consistent across placards |
| 2026-09-16 | Courtyards = paper wider than a disk of 9% plan size (morphological opening), not sealed-wall flood fill | Dashed courtyard walls leak; narrow L4 corridors get sealed by closing |
| 2026-09-16 | A corridor must touch a colored room/stair/elevator | Removes glare blobs, courtyard corners, facade strips generically |
| 2026-09-16 | Auto-accept room numbers at ≥0.5 OCR confidence only if they match the level's `roomPattern` (zoom pass ≥0.75); one number per level | Measured: all ≥0.5 readings matching the pattern were correct; pattern catches the rest |
| 2026-09-16 | Icons: accept template matches ≥0.85, review 0.78–0.85; no star detection | Weak matches were overwhelmingly window dashes/columns |
| 2026-09-16 | Door side is computed in map orientation (image y flipped) | Canonical frame is y-up; keeps left/right correct after px→m transform |
| 2026-09-16 | Pipeline never overwrites a hand-edited proposal (`editedAt` → writes `proposal.auto.json`) | Re-running after a corner fix must not destroy review work |
| 2026-09-16 | `imageTransform` applies to (x, −y); alignment + OSM fit stored in `data/work/<b>/alignment.json` | Similarity has no reflection; alignment is authoring state, not canonical data |
| 2026-09-16 | Canonical rooms may have no number if they have a name (restrooms) | Placards don't number restrooms |
| 2026-09-16 | Auto-align = ICP on outlines from 4 quarter-turn starts; show runner-up fits when close | Placards are drawn in different orientations; Wheeler's footprint is nearly symmetric (270° vs 90° within 8%) |
| 2026-09-16 | Rooms store `labelAt` (OCR position); suite splits assign pieces by it | Merged suites are the most common defect; makes splitting two clicks |
| 2026-09-16 | Author tool displays JPEG copies (`rectified.jpg`, `ingest.jpg`) | 10 MB PNGs inside SVG decoded too slowly |
| 2026-09-29 | Corridor centrelines are NOT rewritten; the wobble is ~0.4 m, not the 5 m the chord suggested | The "L4 trunk is 38.9 m along a 34.0 m chord" figure is not wobble: the corridor threads *between* two rows of rooms whose own alignment is straight to within 0.45 m, so it legitimately runs 2-3 m off its chord and straightening to the chord would drive it through the rooms. Fitting each corridor to its own line instead changes lengths by <1%, sometimes lengthening them, and would have introduced side errors — 0 of 198 doors currently disagree with their room. `apps/author/lib/straighten.ts` and `scripts/straighten-report.mts` are kept as a diagnostic, deliberately not wired into accept |
| 2026-09-29 | The route ribbon is built from corner bisectors with a bevel past a 1.6x miter, and the doorway hop is drawn as a short stub | The old builder offset along a central difference with a 3x miter, so hairpins came out 3.3 m wide and both ends 1.56 m wide; it also drew the 8-10 m hop from a room's centre to its door, which is what put a carpet through the room |
| 2026-09-29 | Floor changes are drawn as a riser spanning the gap with climbing arrows and a label, merged per shaft | A 0.7 m cone on the departure level only, with nothing bridging the two ribbons, did not communicate "go up here"; a shaft passing through a floor also produced two markers where the step list says one thing |
| 2026-09-30 | Stairs and lifts must be linked to the corridor point nearest them; two that were not (L1 `v02`, L3 `v04`) were re-linked with `apps/author/scripts/relink-vertical.mts`, and a routing test now guards the real data | L3's lift was 3.6 m from room 315's door but linked to a junction 5 m the other way, so the accessible route walked west and doubled back (21.1 m, two turns, now 15.4 m). Only 2 of 46 links were like this. The fix splits the corridor at the nearest point (`splitEdge` re-bases every door, so none moved) and drops the long stub. The pipeline's connect stage still attaches to the nearest *node* rather than the nearest point on an edge, so a future building needs this pass (or that stage fixed) |
| 2026-09-30 | Building data is fetched with `cache: "no-cache"` (revalidate every load), not `force-cache` | `force-cache` used the browser's stored copy without asking the server, so after a data change or deploy a returning visitor kept the old floor plans. Found when the corrected L3 still showed the old route in Chrome. The service worker in M5 will need its own update strategy, since it will sit in front of this |
| 2026-09-30 | `apps/nav` types its page params by hand instead of using the generated `PageProps` | `PageProps` only exists after `next typegen` writes `.next/types`, so typecheck passed here (where `.next` always existed) and failed on every clean checkout, including CI |
| 2026-09-30 | Guide steps are placed by the position where each one ends (`Instruction.at`), not by index or by graph node | The step number was used to look up a raw graph edge, of which there are more than twice as many as steps, so every step on an upper floor was framed on the lower one and "Arrive" framed nothing. Node ids were no better: a turn that falls mid-edge gives two consecutive steps the same last node, leaving one with an empty stretch. Projecting each step's end point onto the ribbon gives every step its own span, used both to frame the camera (heading = the step's own direction, so a turn shows as the view turning) and to light that stretch of path |
| 2026-09-30 | Wheel and trackpad-pinch zoom is our own, proportional to the scroll amount; OrbitControls keeps touch pinch only | OrbitControls zooms a fixed percentage per event and ignores deltaY: three mouse-wheel notches moved 7%, a gentle pinch and a violent one both moved 47%, and sixty notches stopped 20 m short of the minimum distance. Scaling the eye about the point under the cursor keeps that point on the same pixel |
| 2026-09-30 | "Show all" is its own state and outranks the route's dimming and solid-view cutaway | It used to clear only the focus, so the route's own dimming returned and the button lit just the levels the route crosses (the middle three). Stepping the guide does not re-focus a level while show-all is on |
| 2026-09-30 | Riser arrows live in the riser's own frame (+y = departure to arrival) and are driven from one phase with a smoothstep fade at each end | The group is already rotated onto the shaft, so the extra flip and reversed slide applied "when descending" turned the cones and their motion the wrong way, and arrows popped at the wrap because they jumped ends at full size. Now the wrap happens where an arrow is invisible |
| 2026-09-30 | Level materials are remounted (via `key`) when a level goes between lit and dimmed | three does not recompile a shader when `transparent` flips on an existing material, so a level that had ever been lit stayed opaque for the rest of the session while the focus chip and legend moved on. Only visible after changing focus client-side, never on a page load, which is why loading a URL looked fine. Not unit-testable in the node harness (needs a WebGL canvas), so it is covered by driving the real click in Chrome |
| 2026-09-30 | A drag turns about the building's centre taken *along the view direction*, and nothing translates while it turns | Neither fixed pivot works alone: the building's centre spins nicely when zoomed out but sweeps the camera off the route when you are down in a corridor 40 m from it, and the point under the view centre is rarely the model's middle. Projecting the centre onto the view axis gives the turntable when you are looking at the building and a local spin when you are inside it, with no jump between |
| 2026-09-30 | ~~Dragging turns the building about whatever is in the middle of the view~~, and nothing translates while it turns | Turning about the grabbed point is physically honest but unusable: grab a corner and a half-turn swings the building off screen. A rigid rotation about the view centre leaves that point pinned to the same pixel, so the model spins in place |
| 2026-09-29 | Dragging turns the building about the point under the cursor, two-finger swipe slides, wheel and pinch zoom | Stock orbiting spun around whatever the last camera flight left as the target, usually off-screen. The wheel is ambiguous between a trackpad swipe and a mouse wheel, so it defaults to zoom and only switches to panning once a trackpad gives itself away; on-screen +/- always work |
| 2026-09-25 | Scene meshes, labels and route all go through `planToShape`/`shapeToScene`/`toScene`, pinned by a test | The mesh path negated y and the label/route path did not, so the building was drawn mirrored against everything on it — the cause of "labels floating over nothing" and most of the apparent corridor mess |
| 2026-09-25 | A room's graph node sits at the polygon's interior point, not its first door; rooms with `enteredVia` get their own node and chains are followed | Routes arriving through a second door jumped up to 16 m across the building, and `enteredVia` rooms ended at the host's door |
| 2026-09-25 | The route is a floor ribbon with chevrons and distance fade, depth-tested per level | The dashed line ignored corridor polylines, floated through ceilings and never said which way to walk |
| 2026-09-25 | The camera only ever moves through an explicit, interruptible flight, never as a side effect of derived state | A `useEffect` re-framing on derived state meant every zoom snapped back to one fixed spot |
| 2026-09-24 | Nav data ships as static JSON in `public/data`, copied by a prebuild step, not imported into the bundle | Keeps the JS bundle small and gives M5's offline shell something a service worker can cache |
| 2026-09-24 | Room labels are drawn only for the focused level, or the route's levels | All six levels at once is an unreadable pile; labels from levels behind still draw over the front one |
| 2026-09-24 | Never give compass directions; leaving a room turns relative to the door you came out of, and leaving a lift or stairwell points at the first room passed | User: "no one knows compass directions"; indoors a bearing is unfollowable |
| 2026-09-24 | Routing instructions simplify each leg (RDP, 2 m) before reading turns; consecutive flights in one shaft merge | Corridor skeletons wobble a metre or two, which produced a turn every few steps and one instruction per floor |
| 2026-09-24 | "Nearest restroom" matches `restroom`, `accessible-restroom` and `gender-inclusive-restroom` | Wheeler's restrooms are all tagged accessible, so a literal match sent people four levels away |
| 2026-09-22 | Merged suites are cut by a watershed on the placard's wall pixels, seeded by each printed number, on demand from the author tool (`POST /suite-split`) | Colored areas merge through doorway gaps, so 15 suites (~60 rooms) shared one outline; an on-demand split keeps hand edits instead of forcing a pipeline re-run |
| 2026-09-22 | Rooms entered through another room carry `enteredVia`; at accept they inherit that room's doors | Inner rooms (B 31A) have no corridor door; routing needs a door, directions should say "through 31" |
| 2026-09-22 | Test the author tool only against a scratch copy (`WF_REPO_ROOT` for Next, `WF_DATA_DIR` for `wf serve`) | Clicking through the tool writes data; the real review is the user's |
