# M4 follow-up: fix and rework the 3D nav scene

> Saved for later — **not started**. Agreed 2026-09-24 after reviewing the nav app in the browser.

## Context

The Wheeler nav app renders, routes and deploys-ready, but looking at it revealed that the 3D view is
misleading and hard to use. The user's complaints: the orange dashed route floats through ceilings and
doesn't say where to walk; the route "bounces into a room and back out" at the destination; you can only
zoom to one fixed spot; corridors look wonky against the rooms; room labels float off their rooms in
white text; and there's no key for the colours.

Investigation found **one root cause behind most of the visual mess, plus three real bugs**:

1. **The building is drawn mirrored.** `shapeOf` (`apps/nav/components/Scene.tsx:21-22`) maps plan
   `(x, y)` → `Vector2(x, -y)`; after `geometry.rotateX(-Math.PI/2)` that lands at scene `z = +y`. But
   labels and the route use `toScene` (`apps/nav/lib/scene.ts:30-32`), which is `z = -y`. **Room blocks
   sit mirrored north–south against the labels, the route and the corridors.** Wheeler's footprint is
   near-symmetric in y, so the flipped building looks plausible and only the labels and route read as
   wrong. On L4, 43 of 63 labels land on no room at all; 408/409/410/411 fall outside the outline.
2. **The route teleports at the end.** A room's graph node is placed at its *first* door
   (`packages/routing/src/graph.ts:163-164`) with zero-cost doorway edges, so arriving via any other
   door draws a straight jump across the building: L1 150A 16.4 m, L3 315 12.6 m, L3 322 4.4 m, B 24
   2.3 m. Worse, `enteredVia` rooms resolve to the *host* room's door (`graph.ts:242`): 17 rooms, up to
   16.9 m off (L1 150 via 150A), and chains like L4 420→419→418 only follow one hop. This is the
   "bounces into a room" screenshot.
3. **The line is drawn as chords.** `routePoints` (`apps/nav/lib/scene.ts:79-81`) uses only node
   positions and ignores `step.edge.polyline`, so bends inside an edge cut across rooms (up to 6.7 m
   off on `wheeler-L1-e026`).
4. **The camera is stuck** because `CameraRig`'s `useEffect` (`Scene.tsx:159-174`) hard-sets
   `camera.position` and the controls target whenever derived state changes — and `heights` changes
   identity on every view toggle, so any zoom snaps back.

Corridor centrelines *are* genuinely bowed in the data (L4's trunk is 38.9 m along a 34.0 m chord;
L1 `e026` sags 6.7 m), but the user chose to **fix the mirror first and judge the corridors from a
correct render** before touching geometry. That decision stands; see "Deferred".

Decided with the user: route drawn as a **solid ribbon on the floor with arrows, fading with distance**;
camera does an **auto fly-in once** (whole building ~1.5 s → walker's-eye view of step 1), then follows
the steps, with user drag taking over and a "Resume guide" pill.

## Stage 0 — pure helpers (no visual change)

- `packages/geometry/src/polygon.ts`: add `interiorPoint(poly)` — area `centroid()` (already there,
  line 16) when it is inside via `pointInPolygon` (line 32), else a pole-of-inaccessibility fallback
  (grid sample the bbox, keep the inside point furthest from any edge, refine twice). Add
  `orientedExtent(poly, angle)` (rotate by −angle, take the bbox) for label sizing. Test with a C-shape
  whose centroid falls outside.
- `apps/nav/lib/scene.ts`: add `planToShape(p)` and `shapeToScene(p, height)` so the two mappings are
  written once, plus `labelColor(category)` (darken the category colour ~0.42, with a WCAG ≥3:1 check
  against the block colour) and `legendEntries(levels, focusLevel)`. Retype `CATEGORY_COLOR` as
  `Record<RoomCategory, string>` so schema changes break the build.

## Stage 1 — the mirror fix

- `Scene.tsx` `shapeOf` uses `planToShape` (i.e. `Vector2(x, y)`), making
  `shapeToScene(planToShape(p), h) === toScene(p, h)` true by construction.
- Labels move to `toScene(interiorPoint(room.polygon), …)`.
- **Check the voids after flipping**: reversing y reverses ring winding. Materials are `FrontSide`, so a
  bad flip shows as a black or invisible slab. If so, reverse the hole rings in `shapeOf` — do not
  switch to `DoubleSide` (doubles fragment cost and ruins the cutaway).
- New tests in `apps/nav/lib/lib.test.ts`: the one-line invariant above, and — the test that would have
  caught this — every L1/L4 room's label point lies inside that room's own scene footprint.

## Stage 2 — routing node fixes (`packages/routing/src/graph.ts`, stays pure)

- Place the room node at `interiorPoint(room.polygon)`, not `doorIds[0]`.
- Give doorway edges a real polyline `[[door], [interior]]` but **keep `meters: 0`** — charging real
  metres would change `route.meters`, break an existing routing test, and perturb `legsOf` in
  `instructions.ts`, for a couple of metres on distances that are deliberately vague.
- Give `enteredVia` rooms their own node, linked from the host by a zero-metre doorway edge, iterating
  to a fixed point so chains resolve; then delete the `enteredVia` fallback in `resolveEndpoint`.
- New tests: every Wheeler room node is inside its own polygon; no doorway edge polyline exceeds ~12 m;
  and the arrive sentence for an `enteredVia` room now names the room itself ("Arrive at 418, which is
  inside 419") — that branch is currently unreachable.

## Stage 3 — the ribbon (`apps/nav/lib/route-geometry.ts`, `components/RouteRibbon.tsx`)

- `routeRibbons(route)` → per-level `{ levelId, points, distances, stepEnds }`, built by walking
  `route.steps` and appending `step.edge.polyline` (reverse edges are already stored reversed in
  `graph.ts:47`; assert the first point matches `step.from`). Vertical steps close a ribbon and emit a
  transition. Points are **level-local** (`[x, 0, -y]`) and rendered inside that level's animated group,
  so the line can't detach from its slab during the exploded↔solid toggle.
- Ribbon mesh: miter-offset triangle strip ~1.1 m wide at `y = 0.06`, `uv.u = distance / 2.2 m`, vec4
  vertex colours for per-vertex alpha. `meshBasicMaterial` with a canvas-generated chevron texture
  (`RepeatWrapping`), `vertexColors`, `transparent`, `depthWrite: false`, **`depthTest: true`** (this is
  the ceiling fix — the current `depthTest={false}` at `Scene.tsx:146` is exactly the defect), and
  `polygonOffset` so it doesn't z-fight the slab. Arrows animate with one line in `useFrame`
  (`map.offset.x -= delta * 0.35`); no geometry churn.
- Distance fade: rewrite only the colour attribute when the active step changes — behind the walker
  0.22, next ~18 m at 0.95, fading to 0.15 by ~35 m; flat 0.8 on the whole-route overview.
- Start sphere and destination cone sit on the floor, parented into their level groups.
- Chosen over drei `<Line>` (screen-space width never reads as floor paint, can't carry arrows) and
  instanced chevrons (bunch up at corners, more code, no cheaper).

## Stage 4 — camera (`apps/nav/lib/camera.ts`, `components/CameraRig.tsx`)

- **Delete the framing `useEffect`.** Every framing change goes through an explicit, cancellable
  `flyTo`; that rule is the whole fix for "stuck camera".
- `OrbitControls` with `minDistance` 8 → 2, a `maxDistance` from the building radius, `zoomToCursor`,
  `screenSpacePanning`, damping — so you can zoom into any part of the building.
- Pure `camera.ts`: `overviewPose` (wraps existing `cameraFor`), `stepPose`, `easeInOutCubic`.
  `stepPose` takes the heading from ~8 m of lookahead (not one segment, so the 3.4 m corridor wander
  doesn't swing the camera), putting the eye ~9 m behind and ~5.5 m above the walker, looking ~10 m
  ahead; clamped inside the level's height in solid view.
- Guide state in React (**not** the URL — it would fight `router.replace` mid-flight): new route →
  overview → 1.5 s → fly 1.6 s to step 1 → following. Tapping a step or Next/Prev flies in 0.9 s and
  sets `level` so the cutaway follows the walker. Takeover is detected by the controls' own `start`
  event (so step taps don't count) → "Resume guide" pill.
- `RoutePanel` gains Next/Prev and highlights the active step.

## Stage 5 — labels and legend

- Flat `<Text>` on the room's top face (no `Billboard`, no white outline), rotated by the level's
  `imageTransform.rotation` folded into (−90°, 90°] so numbers are never upside down — that value is the
  true building axis on every level (outline segments cluster within 0.25°).
- Positioned at `interiorPoint`, sized from `orientedExtent` to fit the room, hidden when it would be
  under ~9 px on screen, coloured by `labelColor` — a deeper shade of the room's own colour.
- L2's duplicate polygons (220/222 and 227/228/229/230/227A render 5 labels at one point) are deduped
  by polygon hash into one label reading `227/228/229…`. It is a data defect: note it in PLAN.md for the
  author tool rather than scattering labels to hide it.
- `components/Legend.tsx`: top-left overlay listing only the categories present, using the same
  `CATEGORY_COLOR` so it can't drift from the model; label text prefers the placard's own `room.group`
  wording, else a `CATEGORY_LABEL` map. Collapsed "Key" chip on phones, open on `md:`. Note `left-3
  top-3` currently holds the "Showing Level …" button — move that to the right.

## Stage 6 (optional) — phantom turns in the step list

Raise `SIMPLIFY_TOLERANCE_M` (`packages/routing/src/instructions.ts:25`) from 2 m to ~3.5 m and snap
each simplified bearing to the level's axis (`rotation + k·90°`) when within ~12°. The L4 trunk
currently yields "turn right … turn left" inside a dead-straight 34 m hallway (81.8° and 78.5° after
RDP). Pure and testable.

## Verification

Per stage, `pnpm typecheck && pnpm test` (schema 8, geometry 9+, routing 15+, author 18, nav 6+), then
in Chrome against the production build (`pnpm --filter @wf/nav build` + `next start`), **with the Chrome
window actually focused** — a background window pauses animation frames and the canvas looks blank or
frozen, which cost real time last session.

- Stage 1: L1's auditorium block sits under the "150" label; L4's north rooms match the placard photo;
  the route lies in corridors, not across rooms; L2's void still renders.
- Stage 2: `pnpm routes wheeler` unchanged; in the browser no end-of-route jump for L1 150A, L3 315,
  L3 322, or 420/419/418.
- Stage 3: route 120 → 315 follows corridor bends; arrows point at the destination; ribbon stays glued
  to its slab across an exploded↔solid toggle; occluded by the slab above in solid view; ≥55 fps at
  phone width.
- Stage 4: pinch-zoom and pan anywhere with no snap-back; load shows the building ~1.5 s then flies to
  step 1; tapping step 4 flies there facing down the corridor; dragging mid-flight stops it and offers
  "Resume guide".
- Stage 5: numbers lie on their rooms, right-reading, legible at ~500 px; no 5-label pile on L2; legend
  matches the blocks.
- Screenshots of the corrected corridors go back to the user for the straightening decision.

## Deferred / decided

- **Corridor straightening**: not in this plan. After stage 1 the user sees the real corridor shape and
  decides. If it goes ahead, the agreed shape is a pure `straightenEdges(proposal, axis)` called from
  `apps/author/lib/accept.ts` (the single writer of canonical data), which must re-derive every door's
  `t` *and* `side` by materialising world points before the edit and re-projecting after — door `t` is a
  fraction of arc length, so straightening L4's trunk would otherwise slide 16 doors by metres. Stair
  and elevator link stubs are genuinely diagonal and must be excluded. Some bows may be real L-bends,
  so check the `graph` debug overlay before asserting a corridor runs somewhere it currently doesn't.
- **Not doing**: straightening geometry only in the renderer (the drawn line would contradict the step
  list); any return of `depthTest: false`; camera state in the URL; charging metres for doorway edges.
- **Vercel deploy** stays parked until the scene looks right.
