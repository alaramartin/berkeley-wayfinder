# Berkeley Wayfinder — Plan

> **Source of truth for what to build and in what order.** Update the Status block and check off tasks as you go. Append new decisions to the Decision log instead of silently changing course.

## Milestones
- [x] **M0 — Scaffold** (done 2026-09-16)
- [x] **M1 — Pipeline** (done 2026-09-16)
- [ ] **M2 — Authoring tool** ← current
- [ ] **M3 — Routing + complete Wheeler data**
- [ ] **M4 — Nav app + deploy**
- [ ] **M5 — Field mode + verification walk**

## Status
- **Current milestone:** M2 — Authoring tool (in progress)
- **Last completed task:** M1 approved and pushed
- **Blockers / waiting on user:** none
- **Next review gate:** end of M2 (user works through review queues, fixes and accepts all levels in the tool)

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

### M2 — Authoring tool
- [ ] building overview + pipeline status; `wf serve` integration.
- [ ] rectify/crop corner editor.
- [ ] level editor (layers, tools, undo/redo, autosave).
- [ ] review queue UI.
- [ ] accept level → canonical JSON (validated).
- [ ] align levels to L1 (anchor pairs, residuals).
- [ ] OSM footprint fetch + L1 fit → local meters + origin.
- [ ] shaft proposal/confirm + level heights editor.
- **Review gate M2.** User works through the review queue and accepts all levels.

### M3 — Routing + complete Wheeler data
- [ ] graph build with virtual door nodes.
- [ ] A* + accessible mode + access filtering.
- [ ] nearest-POI.
- [ ] instruction generation with landmarks.
- [ ] tests on fixtures and **real Wheeler data**: same-floor, multi-floor, accessible (must use the elevator), entrance→room, nearest restroom, unreachable → clear error.
- [ ] all Wheeler levels accepted, aligned, shafts linked; the building validates end to end.
- **Review gate M3.** Print sample routes as text for the user to sanity-check.

### M4 — Nav app + deploy
- [ ] data bundling from `data/buildings`.
- [ ] search (numbers, names, entrances, nearest-X).
- [ ] 3D scene: level meshes, labels, exploded layout.
- [ ] solid dollhouse mode + animated toggle + cutaway.
- [ ] route rendering + camera fit + level focus.
- [ ] bottom sheet / side panel with steps, time, accessible toggle.
- [ ] URL state (shareable links).
- [ ] phone-width checks (screenshots) + performance pass.
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
- [ ] **Level M**: actual vertical position (between B and 1? between 1 and 2?) and elevation. Initial guess: placard list order.
- [x] Levels beyond B–4? Photos cover B, M, 1, 2, 3, 4 only.
- [ ] Door locations for every room (esp. large rooms: 150 auditorium, 100, 130).
- [ ] Locked, card-only or hours-restricted doors and entrances.
- [ ] Real floor-to-floor heights (step counts per flight, per shaft).
- [ ] Which entrances are accessible (placard wheelchair icons suggest the east side on L1; verify).
- [ ] Wheeler's OSM way ID (look up in M2).

## 12. Decision log
| Date | Decision | Why |
|---|---|---|
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
