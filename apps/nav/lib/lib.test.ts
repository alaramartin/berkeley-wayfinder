import { Building, Level } from "@wf/schema";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildGraph } from "@wf/routing";
import { describe, expect, it } from "vitest";
import type { BuildingData } from "./data";
import type { Vec3 } from "./scene";
import { boundsOf, cameraFor, contrastRatio, labelColor, legendEntries, levelHeights, levelVisibility, planToShape, routePoints, shapeToScene, toScene, CATEGORY_COLOR } from "./scene";
import { interiorPoint, pointInPolygon } from "@wf/geometry";
import { instructions, route } from "@wf/routing";
import { type Grab, type Pose, type Touchpoint, clampPose, gesturePose, panOnPlane, roomPose, grabRotate, pivotFor, pointUnderCursor, projectToScreen, spanPose, zoomPose } from "./camera";
import * as THREE from "three";
import { createWheelRouter, zoomFactor } from "./input";
import { createController } from "./controller";
import { loadBuilding } from "./data";
import { ARROW_FADE_FRACTION, advancePhase, riserArrows } from "./riser";
import { alphaAt, guideStepAt, pointAtDistance, ribbonActivity, riserEndingAt, routeGeometry, stepSpan } from "./route-geometry";
import { RIBBON_WIDTH_M, buildRibbonMesh, ribbonWidths } from "./ribbon-mesh";
import { buildIndex, search } from "./search";
import { DEFAULT_STATE, readState, writeState } from "./url";

const root = path.resolve(import.meta.dirname, "../public/data/wheeler");

async function wheeler(): Promise<BuildingData> {
  const building = Building.parse(JSON.parse(await readFile(path.join(root, "building.json"), "utf8")));
  const files = await readdir(path.join(root, "levels"));
  const levels = await Promise.all(
    files.filter((f: string) => f.endsWith(".json")).map(async (f: string) => Level.parse(JSON.parse(await readFile(path.join(root, "levels", f), "utf8")))),
  );
  levels.sort((a, b) => a.sortIndex - b.sortIndex);
  return { building, levels, graph: buildGraph(building, levels) };
}

describe("url state", () => {
  it("round-trips and keeps shared links short", () => {
    const state = { ...DEFAULT_STATE, from: "wheeler-L1-r120", to: "wheeler-L3-r315", accessible: true };
    const params = writeState(state);
    expect(params.toString()).toBe("from=wheeler-L1-r120&to=wheeler-L3-r315&accessible=1");
    expect(readState(params)).toEqual(state);
    expect(writeState(DEFAULT_STATE).toString()).toBe("");
  });
});

describe("scene maths", () => {
  it("keeps the plan the right way round and stacks levels", async () => {
    const { building, levels } = await wheeler();
    // North (+y) becomes -z so the plan is not mirrored.
    expect(toScene([3, 4], 2)).toEqual([3, 2, -4]);

    const solid = levelHeights(building, levels, "solid");
    const exploded = levelHeights(building, levels, "exploded");
    const order = [...levels].sort((a, b) => a.sortIndex - b.sortIndex).map((l) => l.id);
    for (let i = 1; i < order.length; i++) {
      expect(solid.get(order[i]!)!).toBeGreaterThan(solid.get(order[i - 1]!)!);
      expect(exploded.get(order[i]!)!).toBeGreaterThan(exploded.get(order[i - 1]!)!);
    }
    // Exploded pulls the levels further apart than their real elevations.
    const span = (m: Map<string, number>) => m.get(order[order.length - 1]!)! - m.get(order[0]!)!;
    expect(span(exploded)).toBeGreaterThan(span(solid));
  });

  it("fits a camera around the points it is given", () => {
    const b = boundsOf([
      [0, 0, 0],
      [10, 4, -10],
    ]);
    expect(b.center).toEqual([5, 2, -5]);
    const eye = cameraFor(b.center, b.radius);
    expect(Math.hypot(eye[0] - b.center[0], eye[1] - b.center[1], eye[2] - b.center[2])).toBeGreaterThan(b.radius);
  });

  it("lifts route points above the floor of their level", async () => {
    const { building, levels } = await wheeler();
    const heights = levelHeights(building, levels, "exploded");
    const points = routePoints([{ x: 1, y: 2, levelId: levels[0]!.id }], heights);
    expect(points[0]![1]).toBeCloseTo((heights.get(levels[0]!.id) ?? 0) + 0.6, 5);
  });
});

describe("mesh and label frames agree", () => {
  it("maps a plan point the same way through the shape path and toScene", () => {
    // The mirror bug: shapeOf negated y, so meshes landed at z = +y while labels used z = -y.
    expect(shapeToScene(planToShape([3, 4]), 2)).toEqual(toScene([3, 4], 2));
  });

  it("puts every room's label inside that room's own mesh footprint", async () => {
    const { levels } = await wheeler();
    const offenders: string[] = [];
    for (const level of levels) {
      for (const room of level.rooms) {
        if (!room.number || room.category === "service") continue;
        // The footprint as the mesh actually lands in the scene, in XZ.
        const footprint = room.polygon.map((p) => {
          const v = shapeToScene(planToShape(p), 0);
          return [v[0], v[2]] as [number, number];
        });
        const label = toScene(interiorPoint(room.polygon), 0);
        if (!pointInPolygon([label[0], label[2]], footprint)) offenders.push(`${level.id} ${room.number}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("labels and legend", () => {
  it("gives each category a deeper shade of its own colour", () => {
    for (const [category, block] of Object.entries(CATEGORY_COLOR)) {
      const label = labelColor(category as keyof typeof CATEGORY_COLOR);
      expect(contrastRatio(label, block)).toBeGreaterThanOrEqual(3);
    }
  });

  it("lists only the categories present, never service", async () => {
    const { levels } = await wheeler();
    const entries = legendEntries(levels);
    const categories = entries.map((e) => e.category);
    expect(categories).toContain("office");
    expect(categories).toContain("classroom");
    expect(categories).not.toContain("service");
    expect(new Set(categories).size).toBe(categories.length);
    for (const entry of entries) expect(entry.color).toBe(CATEGORY_COLOR[entry.category]);

    const l1Only = legendEntries(levels, "L1");
    expect(l1Only.length).toBeLessThanOrEqual(entries.length);
  });
});

describe("route geometry", () => {
  it("follows corridor polylines, splits at levels, and ends inside the room", async () => {
    const data = await wheeler();
    const found = route(data.graph, { type: "room", id: "wheeler-L1-r120" }, { type: "room", id: "wheeler-L3-r315" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;

    const geometry = routeGeometry(found.route);
    expect(geometry.ribbons.length).toBeGreaterThan(1);
    // One ribbon per level stretch, each on a level the route visits.
    for (const ribbon of geometry.ribbons) {
      expect(found.route.levelIds).toContain(ribbon.levelId);
      expect(ribbon.points.length).toBe(ribbon.distances.length);
      expect(ribbon.distances[0]).toBe(0);
    }
    // Tracing the corridor means more points than the old node-to-node chords.
    const totalPoints = geometry.ribbons.reduce((n, r) => n + r.points.length, 0);
    expect(totalPoints).toBeGreaterThan(found.route.nodes.length / 2);
    expect(geometry.transitions.length).toBeGreaterThan(0);

    // The last point sits a short step past the arrival door, not out on the corridor and not away
    // across the room at its centre. (Doors are still unverified field data, so some sit further from
    // their room's outline than the drawn stub reaches — hence distance to the door, not containment.)
    const last = geometry.ribbons[geometry.ribbons.length - 1]!;
    const end = last.points[last.points.length - 1]!;
    const room = data.graph.rooms.get("wheeler-L3-r315")!;
    const doorNodes = (data.graph.roomDoors.get(room.id) ?? []).map((id) => data.graph.nodes.get(id)!);
    const toNearestDoor = Math.min(...doorNodes.map((d) => Math.hypot(end[0] - d.x, -end[2] - d.y)));
    expect(toNearestDoor).toBeLessThan(2.5);
    const centre = interiorPoint(room.polygon);
    expect(Math.hypot(end[0] - centre[0], -end[2] - centre[1])).toBeGreaterThan(2.5);
  });

  /** The routes the guide tests walk through: one floor, three floors, and the whole building. */
  const ROUTES: [string, string][] = [
    ["wheeler-L1-r120", "wheeler-L1-r130"],
    ["wheeler-L1-r120", "wheeler-L3-r315"],
    ["wheeler-B-r24", "wheeler-L4-r450"],
  ];

  async function guided(from: string, to: string) {
    const data = await wheeler();
    const found = route(data.graph, { type: "room", id: from }, { type: "room", id: to });
    if (!found.ok) throw new Error(found.error);
    const steps = instructions(data.graph, found.route);
    return { data, route: found.route, steps, geometry: routeGeometry(found.route) };
  }

  it("finds each guide step on its own floor, not by counting graph edges", async () => {
    // The guide's steps are runs of several graph edges. Looking a step up by its number among the raw
    // edges put every step on the upper floor onto the lower one, and left "Arrive" with nothing at all.
    for (const [from, to] of ROUTES) {
      const { steps, geometry } = await guided(from, to);
      steps.forEach((step, i) => {
        const guide = guideStepAt(steps, i)!;
        if (step.kind === "vertical") {
          expect(riserEndingAt(geometry, guide.toNodeId), `${from}->${to} step ${i}`).not.toBeNull();
          return;
        }
        const span = stepSpan(geometry, guide);
        expect(span, `${from}->${to} step ${i} "${step.text}"`).not.toBeNull();
        expect(span!.ribbon.levelId, `${from}->${to} step ${i}`).toBe(step.levelId);
      });
    }
  });

  it("moves along the route as the guide steps forward", async () => {
    const { steps, geometry } = await guided("wheeler-L1-r120", "wheeler-L3-r315");
    let previous: { ribbon: unknown; end: number } | null = null;
    steps.forEach((step, i) => {
      if (step.kind === "vertical") return;
      const span = stepSpan(geometry, guideStepAt(steps, i)!)!;
      if (previous && previous.ribbon === span.ribbon) {
        // Each step picks up where the last one ended, and never goes backwards.
        expect(span.startDistance).toBeGreaterThanOrEqual(previous.end - 0.01);
        expect(span.endDistance).toBeGreaterThanOrEqual(span.startDistance);
      }
      previous = { ribbon: span.ribbon, end: span.endDistance };
    });
  });

  it("frames a step's own stretch of path in the view", async () => {
    const viewport = { width: 1200, height: 800 };
    for (const [from, to] of ROUTES) {
      const { steps, geometry } = await guided(from, to);
      steps.forEach((step, i) => {
        if (step.kind === "vertical") return;
        const span = stepSpan(geometry, guideStepAt(steps, i)!)!;
        const pose = spanPose(span.ribbon, span.startDistance, span.endDistance, 0);
        for (const distance of [span.startDistance, span.endDistance]) {
          const at = pointAtDistance(span.ribbon, distance);
          const px = projectToScreen(pose, [at[0], 0, at[2]], viewport, 45);
          expect(px.x, `${from}->${to} step ${i} at ${distance.toFixed(1)} m`).toBeGreaterThan(-viewport.width * 0.05);
          expect(px.x).toBeLessThan(viewport.width * 1.05);
          expect(px.y).toBeGreaterThan(-viewport.height * 0.05);
          expect(px.y).toBeLessThan(viewport.height * 1.05);
        }
      });
    }
  });

  it("looks somewhere different on each step, turning when the step turns", async () => {
    // Clicking through the guide used to zoom in a hair and nudge the camera. Consecutive steps must
    // visibly differ, and a turn in the instructions must show up as the view turning.
    const { steps, geometry } = await guided("wheeler-L1-r120", "wheeler-L3-r315");
    const poses = steps.map((step, i) => {
      if (step.kind === "vertical") return null;
      const span = stepSpan(geometry, guideStepAt(steps, i)!)!;
      return { pose: spanPose(span.ribbon, span.startDistance, span.endDistance, 0), level: span.ribbon.levelId };
    });
    const heading = (p: Pose) => Math.atan2(p.target[2] - p.eye[2], p.target[0] - p.eye[0]);
    let biggestTurn = 0;
    for (let i = 1; i < poses.length; i++) {
      const a = poses[i - 1];
      const b = poses[i];
      if (!a || !b || a.level !== b.level) continue;
      const moved = Math.hypot(a.pose.eye[0] - b.pose.eye[0], a.pose.eye[2] - b.pose.eye[2]);
      let turn = Math.abs(heading(a.pose) - heading(b.pose));
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      biggestTurn = Math.max(biggestTurn, (turn * 180) / Math.PI);
      // Either the camera has gone somewhere else or it is pointing somewhere else.
      expect(moved > 0.75 || turn > 0.3, `step ${i - 1} -> ${i}`).toBe(true);
    }
    expect(biggestTurn).toBeGreaterThan(45);
  });

  it("lights the current step and dims what is behind it", async () => {
    const { steps, geometry } = await guided("wheeler-L1-r120", "wheeler-L3-r315");
    const [lower, upper] = geometry.ribbons;
    const vertical = steps.findIndex((s) => s.kind === "vertical");
    // At the stairs, everything on the lower floor is behind you and the upper floor is still to come.
    const atStairs = guideStepAt(steps, vertical)!;
    expect(alphaAt(3, ribbonActivity(geometry, atStairs, lower!))).toBeLessThan(0.3);
    expect(alphaAt(3, ribbonActivity(geometry, atStairs, upper!))).toBeGreaterThan(0.8);
    // On the upper floor the lower ribbon stays dimmed, and the step's own stretch is the brightest.
    const arrive = guideStepAt(steps, steps.length - 1)!;
    expect(alphaAt(3, ribbonActivity(geometry, arrive, lower!))).toBeLessThan(0.3);
    const span = stepSpan(geometry, arrive)!;
    const activity = ribbonActivity(geometry, arrive, upper!);
    expect(alphaAt((span.startDistance + span.endDistance) / 2, activity)).toBe(1);
  });

  it("fades the path behind the walker and far ahead", () => {
    expect(alphaAt(50, null)).toBeCloseTo(0.8, 5);
    expect(alphaAt(5, 20)).toBeLessThan(0.3);
    expect(alphaAt(25, 20)).toBeGreaterThan(0.8);
    expect(alphaAt(70, 20)).toBeLessThan(0.2);
  });
});

describe("ribbon mesh", () => {
  it("keeps its width at every corner, including hairpins and both ends", () => {
    // The old builder offset along a central difference with a miter up to 3x, so a hairpin came out
    // 3.3 m wide and both ends 1.56 m wide, which is what made the route look like a carpet.
    const path: Vec3[] = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 6],
      [10.2, 0, 0.2],
      [20, 0, 0],
    ];
    const distances = [0, 10, 16, 22, 32];
    const widths = ribbonWidths(buildRibbonMesh(path, distances));
    for (const w of widths) {
      expect(w).toBeGreaterThan(RIBBON_WIDTH_M * 0.95);
      expect(w).toBeLessThan(RIBBON_WIDTH_M * 1.65);
    }
  });

  it("draws a real ribbon for a real route, without carpets", async () => {
    const data = await wheeler();
    const found = route(data.graph, { type: "room", id: "wheeler-L1-r120" }, { type: "room", id: "wheeler-L3-r315" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const geometry = routeGeometry(found.route);
    for (const ribbon of geometry.ribbons) {
      const widths = ribbonWidths(buildRibbonMesh(ribbon.points, ribbon.distances));
      expect(Math.max(...widths)).toBeLessThan(1.4);
      expect(Math.min(...widths)).toBeGreaterThan(0.7);
    }
  });
});

describe("route drawing stops at the doorway", () => {
  it("does not drive the ribbon across the room to its centre", async () => {
    const data = await wheeler();
    const found = route(data.graph, { type: "room", id: "wheeler-L1-r120" }, { type: "room", id: "wheeler-L3-r315" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const geometry = routeGeometry(found.route);

    // The room node sits in the middle of the room: the hop is 8.3 m across 120 and 9.7 m across 315.
    // Drawing those hops was what put a wide orange carpet through both rooms.
    const points = geometry.ribbons.flatMap((r) => r.points);
    for (const id of ["wheeler-L1-r120", "wheeler-L3-r315"]) {
      const room = data.graph.rooms.get(id)!;
      const centre = interiorPoint(room.polygon);
      const nearest = Math.min(...points.map((p) => Math.hypot(p[0] - centre[0], -p[2] - centre[1])));
      expect(nearest).toBeGreaterThan(2.5);
    }

    // The drawn path and the quoted distance now agree.
    const drawn = geometry.ribbons.reduce((total, r) => total + (r.distances[r.distances.length - 1] ?? 0), 0);
    expect(Math.abs(drawn - geometry.meters)).toBeLessThan(1.5);
  });
});

describe("floor changes", () => {
  it("collapses a shaft that passes through a floor into one riser", async () => {
    const data = await wheeler();
    const found = route(data.graph, { type: "room", id: "wheeler-L1-r120" }, { type: "room", id: "wheeler-L3-r315" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const geometry = routeGeometry(found.route);

    // The shaft chains L1 -> L2 -> L3, so the route has two transitions; the step list says
    // "up to Level 3" once and the scene must agree.
    expect(geometry.transitions.length).toBe(2);
    expect(geometry.risers.length).toBe(1);
    const riser = geometry.risers[0]!;
    expect(riser.fromLevelId).toBe("L1");
    expect(riser.toLevelId).toBe("L3");
    expect(riser.kind).toBe("stair");
  });

  it("bridges every gap between ribbons", async () => {
    const data = await wheeler();
    const found = route(data.graph, { type: "room", id: "wheeler-B-r24" }, { type: "room", id: "wheeler-L4-r450" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const geometry = routeGeometry(found.route);
    // A break between two ribbons only happens at a floor change, so each one needs a riser.
    expect(geometry.risers.length).toBeGreaterThanOrEqual(1);
    expect(geometry.ribbons.length - 1).toBeLessThanOrEqual(geometry.transitions.length);
    for (const riser of geometry.risers) expect(riser.fromLevelId).not.toBe(riser.toLevelId);
  });
});

describe("grab and turn", () => {
  const viewport = { width: 1200, height: 800 };
  // The pivot is deliberately NOT the camera's target: after a guided flight the target sits ten
  // metres ahead of the walker, and grabbing anything else used to re-aim the camera at it.
  const grab: Grab = {
    pose: { eye: [40, 30, 40], target: [6, 1, -4] },
    pivot: [0, 0, 0],
    cursor: { x: 600, y: 400 },
    viewport,
    fovDegrees: 45,
  };

  it("keeps the point it turns about pinned to the same place on screen", () => {
    // This is what stops the building wandering off-frame: however far you spin, the thing you are
    // looking at stays where it is. The pivot comes from the middle of the view, so it stays there.
    const centre: Grab = { ...grab, cursor: projectToScreen(grab.pose, grab.pivot, viewport, grab.fovDegrees) };
    for (const [dx, dy] of [
      [120, 0],
      [-200, 40],
      [0, 90],
      [-340, -120],
      [500, 60],
    ]) {
      const cursor = { x: centre.cursor.x + dx!, y: centre.cursor.y + dy! };
      const pose = grabRotate(centre, cursor);
      const back = projectToScreen(pose, centre.pivot, viewport, centre.fovDegrees);
      expect(Math.hypot(back.x - centre.cursor.x, back.y - centre.cursor.y)).toBeLessThan(2);
    }
  });

  it("turns the model with the drag and keeps the tilt sane", () => {
    const right = grabRotate(grab, { x: grab.cursor.x + 150, y: grab.cursor.y });
    const left = grabRotate(grab, { x: grab.cursor.x - 150, y: grab.cursor.y });
    // Opposite drags turn the camera opposite ways around the pivot.
    expect(Math.sign(right.eye[0] - grab.pose.eye[0])).not.toBe(Math.sign(left.eye[0] - grab.pose.eye[0]));

    // Dragging far up or down never flips the model over: the camera stays above the pivot and the
    // view keeps pointing down at it.
    for (const dy of [-5000, 5000]) {
      const pose = grabRotate(grab, { x: grab.cursor.x, y: grab.cursor.y + dy });
      expect(pose.eye[1]).toBeGreaterThan(pose.target[1]);
    }
  });

  it("turns about the model when looking at it, and about what is ahead when zoomed in", () => {
    const centre: Vec3 = [0, 0, 0];
    const radius = 40;

    // Zoomed out, looking at the building: the pivot is the building itself, so it spins in place.
    const far = pivotFor({ eye: [80, 60, 80], target: centre }, centre, radius);
    expect(Math.hypot(far[0] - centre[0], far[1] - centre[1], far[2] - centre[2])).toBeLessThan(1);

    // Down in a corridor looking away from the middle: turning about the centre 60 m behind would
    // sweep the camera off the route, so the pivot sits just ahead instead.
    const inside = pivotFor({ eye: [30, 2, 30], target: [42, 2, 42] }, centre, radius);
    const fromEye = Math.hypot(inside[0] - 30, inside[1] - 2, inside[2] - 30);
    expect(fromEye).toBeGreaterThan(0);
    expect(fromEye).toBeLessThan(20);
  });

  it("does nothing when the cursor has not moved", () => {
    const pose = grabRotate(grab, grab.cursor);
    for (let i = 0; i < 3; i++) {
      expect(pose.eye[i]).toBeCloseTo(grab.pose.eye[i]!, 6);
      expect(pose.target[i]).toBeCloseTo(grab.pose.target[i]!, 6);
    }
  });

  it("starts moving smoothly, with no jump on the first pixel", () => {
    // The jitter: the first move used to re-point the camera at the grabbed spot, so the view snapped
    // once and was smooth afterwards. A one-pixel drag must barely change anything.
    const step = (dx: number) => grabRotate(grab, { x: grab.cursor.x + dx, y: grab.cursor.y });
    const move = (a: Pose, b: Pose) =>
      Math.max(
        Math.hypot(a.eye[0] - b.eye[0], a.eye[1] - b.eye[1], a.eye[2] - b.eye[2]),
        Math.hypot(a.target[0] - b.target[0], a.target[1] - b.target[1], a.target[2] - b.target[2]),
      );

    const first = move(grab.pose, step(1));
    const later = move(step(20), step(21));
    expect(first).toBeLessThan(1);
    // The very first pixel moves the camera about as much as any other pixel: no discontinuity.
    expect(first).toBeLessThan(later * 3);
  });

  it("turns the model about the grabbed point rather than the old camera target", () => {
    const pose = grabRotate(grab, { x: grab.cursor.x + 200, y: grab.cursor.y });
    // The camera swings around the pivot rather than being re-aimed at it: it stays roughly the same
    // distance away, and what it was looking at is carried along instead of being discarded.
    const before = Math.hypot(grab.pose.eye[0] - grab.pivot[0], grab.pose.eye[1] - grab.pivot[1], grab.pose.eye[2] - grab.pivot[2]);
    const after = Math.hypot(pose.eye[0] - grab.pivot[0], pose.eye[1] - grab.pivot[1], pose.eye[2] - grab.pivot[2]);
    expect(Math.abs(after - before)).toBeLessThan(before * 0.1);
    expect(pose.target).not.toEqual(grab.pivot);
  });
});

describe("telling a trackpad from a mouse", () => {
  const wheel = (over: Partial<Parameters<ReturnType<typeof createWheelRouter>["route"]>[0]>, at = 0) => ({
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    timeStamp: at,
    ...over,
  });

  it("keeps zoom working for a mouse, forever", () => {
    // The failure that matters: mapping plain wheels to panning would leave a mouse with no zoom.
    const router = createWheelRouter();
    for (let i = 0; i < 50; i++) {
      const intent = router.route(wheel({ deltaY: i % 2 ? 100 : -120 }, i * 30));
      expect(intent.kind).toBe("zoom");
    }
    expect(router.device()).not.toBe("trackpad");
  });

  it("switches to panning once a trackpad gives itself away", () => {
    const router = createWheelRouter();
    expect(router.route(wheel({ deltaY: 2.5 }, 0)).kind).toBe("pan");
    expect(router.route(wheel({ deltaY: 4, deltaX: -1 }, 16)).kind).toBe("pan");
    expect(router.device()).toBe("trackpad");
  });

  it("treats a pinch as zoom without mistaking it for a trackpad swipe", () => {
    const router = createWheelRouter();
    expect(router.route(wheel({ deltaY: -2.5, ctrlKey: true }, 0)).kind).toBe("zoom");
    // A pinch must not latch the router, or a mouse plugged in later would pan instead of zoom.
    expect(router.route(wheel({ deltaY: 120 }, 100)).kind).toBe("zoom");
  });

  it("honours an explicit device choice", () => {
    expect(createWheelRouter("mouse").route(wheel({ deltaY: 1.5, deltaX: 0.2 })).kind).toBe("zoom");
    expect(createWheelRouter("trackpad").route(wheel({ deltaY: 120 })).kind).toBe("pan");
  });

  it("does not latch on a shift-wheel, which mice send sideways", () => {
    const router = createWheelRouter();
    expect(router.route(wheel({ deltaX: 120, deltaY: 0, shiftKey: true })).kind).toBe("zoom");
    expect(router.device()).not.toBe("trackpad");
  });
});

describe("riser arrows", () => {
  const length = 12;
  const count = 5;

  it("head the way you are going, whether the route climbs or descends", () => {
    // The riser group is rotated so its local +y runs from departure to arrival. If that ever stops
    // being true for a descent, the arrows point and slide the wrong way, as they once did.
    for (const [from, to] of [
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 12, 1)], // up
      [new THREE.Vector3(3, 12, 1), new THREE.Vector3(0, 0, 0)], // down
    ]) {
      const direction = to!.clone().sub(from!).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      const local = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      expect(local.distanceTo(direction)).toBeLessThan(1e-6);
    }
    // And the slide is always towards +y: positions only ever increase until an arrow wraps.
    const a = riserArrows(0.30, count, length);
    const b = riserArrows(0.31, count, length);
    for (let i = 0; i < count; i++) expect(b[i]!.y).toBeGreaterThan(a[i]!.y);
  });

  it("glide in and out instead of popping when they wrap", () => {
    // The pop: an arrow reaching the end jumped to the other end at full size. Where one wraps it must
    // be invisible, and it must ease in from nothing at the start and out to nothing at the end.
    let worstJump = 0;
    let previous = riserArrows(0, count, length);
    for (let step = 1; step <= 400; step++) {
      const now = riserArrows(step / 400, count, length);
      now.forEach((arrow, i) => {
        const wrapped = arrow.y < previous[i]!.y;
        if (wrapped) worstJump = Math.max(worstJump, arrow.fade, previous[i]!.fade);
      });
      previous = now;
    }
    expect(worstJump).toBeLessThan(0.05);

    // Fully visible mid-way, and gone at both ends.
    const middle = riserArrows(0, 1, length)[0]!;
    expect(middle.fade).toBeLessThan(0.05);
    expect(riserArrows(0.5, 1, length)[0]!.fade).toBeCloseTo(1, 5);
    expect(riserArrows(ARROW_FADE_FRACTION / 2, 1, length)[0]!.fade).toBeLessThan(0.6);
  });

  it("moves at the same speed on a long riser as a short one", () => {
    const shortRise = advancePhase(0, 1, 6) * 6;
    const longRise = advancePhase(0, 1, 24) * 24;
    expect(shortRise).toBeCloseTo(longRise, 6);
  });
});

describe("loading building data", () => {
  it("revalidates instead of trusting the browser's stored copy", async () => {
    // With `force-cache` a returning visitor never saw an updated floor plan.
    const seen: (RequestCache | undefined)[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.cache);
      const file = path.join(root, String(input).replace(/^\/data\/wheeler\//, ""));
      return new Response(await readFile(file, "utf8"), { status: 200 });
    }) as typeof fetch;
    try {
      await loadBuilding("wheeler");
    } finally {
      globalThis.fetch = original;
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((c) => c === "no-cache")).toBe(true);
  });
});

describe("zoom", () => {
  const viewport = { width: 1200, height: 800 };
  const start: Pose = { eye: [60, 40, 60], target: [0, 0, 0] };
  const limits = { min: 2, max: 300 };
  const distance = (p: Pose) => Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]);
  const wheel = (deltaY: number, extra: object = {}) => ({ deltaY, deltaMode: 0, ctrlKey: false, ...extra });

  it("is proportional to how far you scroll, in the right direction", () => {
    // The stock controls zoomed a fixed percentage per event, so a gentle pinch and a violent one did
    // exactly the same thing.
    expect(zoomFactor(wheel(-4, { ctrlKey: true }))).toBeLessThan(1);
    expect(zoomFactor(wheel(4, { ctrlKey: true }))).toBeGreaterThan(1);
    expect(zoomFactor(wheel(-40, { ctrlKey: true }))).toBeLessThan(zoomFactor(wheel(-4, { ctrlKey: true })));
    expect(zoomFactor(wheel(-30)) * zoomFactor(wheel(30))).toBeCloseTo(1, 10);
    // A flick cannot fling the camera.
    expect(zoomFactor(wheel(-4000))).toBeCloseTo(zoomFactor(wheel(-120)), 10);
    // A mouse reporting lines rather than pixels zooms about as much as one reporting pixels.
    expect(zoomFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(zoomFactor(wheel(-48)), 10);
  });

  it("makes three mouse-wheel notches a clear step, not 7%", () => {
    let pose = start;
    const before = distance(pose);
    for (let i = 0; i < 3; i++) pose = zoomPose(pose, zoomFactor(wheel(-100)), null, viewport, 45, limits);
    expect(distance(pose) / before).toBeLessThan(0.75);
  });

  it("can always reach the closest and furthest distance", () => {
    // Sixty notches used to leave the camera 20 m out with the limit at 2 m.
    let pose = start;
    for (let i = 0; i < 80; i++) pose = zoomPose(pose, zoomFactor(wheel(-100)), null, viewport, 45, limits);
    expect(distance(pose)).toBeCloseTo(limits.min, 6);
    for (let i = 0; i < 200; i++) pose = zoomPose(pose, zoomFactor(wheel(100)), null, viewport, 45, limits);
    expect(distance(pose)).toBeCloseTo(limits.max, 6);
  });

  it("does not stick at a limit: zooming the other way works straight away", () => {
    const atMin = zoomPose(start, 0.0001, null, viewport, 45, limits);
    expect(distance(atMin)).toBeCloseTo(limits.min, 6);
    expect(distance(zoomPose(atMin, 0.5, null, viewport, 45, limits))).toBeCloseTo(limits.min, 6);
    expect(distance(zoomPose(atMin, 1.5, null, viewport, 45, limits))).toBeGreaterThan(limits.min + 0.5);
  });

  it("keeps the point under the cursor on the same pixel", () => {
    const cursor = { x: 900, y: 250 };
    const anchor = pointUnderCursor(start, cursor, viewport, 45, start.target);
    for (const factor of [0.5, 0.8, 1.3]) {
      const after = zoomPose(start, factor, cursor, viewport, 45, limits);
      const px = projectToScreen(after, anchor, viewport, 45);
      expect(Math.hypot(px.x - cursor.x, px.y - cursor.y)).toBeLessThan(1);
    }
  });
});

describe("which levels are lit", () => {
  const levelIds = ["B", "M", "L1", "L2", "L3", "L4"];
  const order = new Map(levelIds.map((id, i) => [id, i]));
  const base = { levelIds, order, focusLevel: null, routeLevels: ["L1", "L2", "L3"], walkingLevel: null, showAll: false, view: "exploded" as const };

  it("dims the levels a route does not touch", () => {
    const v = levelVisibility(base);
    expect([...v.dimmed].sort()).toEqual(["B", "L4", "M"]);
  });

  it("lights every level when the user says show all", () => {
    // "Show all" used to clear only the focus, so the route's dimming came straight back and it
    // appeared to light just the middle three levels.
    const v = levelVisibility({ ...base, showAll: true });
    expect(v.dimmed.size).toBe(0);
    const solid = levelVisibility({ ...base, showAll: true, view: "solid", walkingLevel: "L2" });
    expect(solid.hidden.size).toBe(0);
  });

  it("still focuses one level, whatever show all was", () => {
    const v = levelVisibility({ ...base, focusLevel: "L2", showAll: true });
    expect([...v.dimmed].sort()).toEqual(["B", "L1", "L3", "L4", "M"]);
    expect([...v.labelled]).toEqual(["L2"]);
  });

  it("cuts away above the route in solid view, and above the level being walked", () => {
    expect([...levelVisibility({ ...base, view: "solid" }).hidden]).toEqual(["L4"]);
    expect([...levelVisibility({ ...base, view: "solid", walkingLevel: "L1" }).hidden].sort()).toEqual(["L2", "L3", "L4"]);
  });
});

describe("search", () => {
  it("finds rooms by number, name and alias, and offers nearest-X", async () => {
    const data = await wheeler();
    const index = buildIndex(data);

    const byNumber = search(index, "150");
    expect(byNumber[0]!.label).toMatch(/150/);

    const byName = search(index, "auditorium");
    expect(byName.some((r) => /150/.test(r.label) || /auditorium/i.test(r.detail))).toBe(true);

    const nearest = search(index, "nearest restroom");
    expect(nearest[0]).toMatchObject({ target: { type: "nearest", kind: "restroom" }, needsFrom: true });

    // A plain word still finds rooms first, with the nearest-X option after.
    const plain = search(index, "elevator");
    expect(plain.some((r) => r.target.type === "nearest")).toBe(true);
  });

  it("leaves out mechanical spaces", async () => {
    const data = await wheeler();
    const index = buildIndex(data);
    const serviceIds = new Set(data.levels.flatMap((l) => l.rooms.filter((r) => r.category === "service").map((r) => r.id)));
    const hits = search(index, "wheeler", 50).filter((r) => r.target.type === "room" && serviceIds.has(r.target.id));
    expect(hits).toEqual([]);
  });
});

describe("camera controller", () => {
  const viewport = { width: 800, height: 600 };
  const start: Pose = { eye: [0, 50, 60], target: [0, 0, 0] };
  const world = (pose: Pose, p: Vec3, viewportSize = viewport) => projectToScreen(pose, p, viewportSize, 45);
  const build = () => {
    const log = { pose: start, takeovers: 0, glides: [] as Pose[] };
    const controller = createController({
      getPose: () => log.pose,
      setPose: (p) => (log.pose = p),
      viewport: () => viewport,
      fovDegrees: 45,
      limits: () => ({ min: 2, max: 400 }),
      centre: [0, 0, 0],
      radius: 60,
      onTakeover: () => log.takeovers++,
      animateTo: (p) => log.glides.push(p),
    });
    return { controller, log };
  };
  const finger = (id: number, x: number, y: number, time: number, extra: object = {}) => ({ id, x, y, time, type: "touch" as const, button: 0, ...extra });
  const eyeAngle = (pose: Pose) => Math.atan2(pose.eye[0] - pose.target[0], pose.eye[2] - pose.target[2]);

  it("one finger slides the model with the finger, and not before it has really moved", () => {
    const { controller, log } = build();
    controller.down(finger(1, 400, 300, 0));
    controller.move(finger(1, 402, 301, 10));
    expect(log.pose).toBe(start);
    expect(log.takeovers).toBe(0);
    const point = pointUnderCursor(start, { x: 400, y: 300 }, viewport, 45, [0, 0, 0]);
    controller.move(finger(1, 500, 340, 30));
    controller.move(finger(1, 600, 360, 50));
    expect(log.takeovers).toBe(1);
    // It slides rather than turns, and the spot under the finger stays under it.
    expect(eyeAngle(log.pose)).toBeCloseTo(eyeAngle(start), 5);
    const now = world(log.pose, point);
    expect(Math.hypot(now.x - 600, now.y - 360)).toBeLessThan(2);
  });

  it("a tap does not take the camera from the guide", () => {
    const { controller, log } = build();
    controller.down(finger(1, 400, 300, 0));
    controller.up(finger(1, 400, 300, 80));
    expect(log.takeovers).toBe(0);
  });

  it("two quick taps zoom in on the spot", () => {
    const { controller, log } = build();
    controller.down(finger(1, 400, 300, 0));
    controller.up(finger(1, 400, 300, 60));
    controller.down(finger(1, 404, 302, 200));
    controller.up(finger(1, 404, 302, 260));
    expect(log.glides).toHaveLength(1);
    const d = (p: Pose) => Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]);
    expect(d(log.glides[0]!)).toBeLessThan(d(start));
  });

  it("two slow taps are two taps, not a zoom", () => {
    const { controller, log } = build();
    controller.down(finger(1, 400, 300, 0));
    controller.up(finger(1, 400, 300, 60));
    controller.down(finger(1, 400, 300, 900));
    controller.up(finger(1, 400, 300, 960));
    expect(log.glides).toHaveLength(0);
  });

  it("swiping with two fingers turns the model without zooming", () => {
    const dist = (p: Pose) => Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]);
    const { controller, log } = build();
    controller.down(finger(1, 350, 300, 0));
    controller.down(finger(2, 450, 300, 5));
    for (let i = 1; i <= 10; i++) {
      controller.move(finger(1, 350 + i * 15, 300, 10 + i * 10));
      controller.move(finger(2, 450 + i * 15, 300, 10 + i * 10));
    }
    expect(eyeAngle(log.pose)).not.toBeCloseTo(eyeAngle(start), 2);
    expect(dist(log.pose)).toBeCloseTo(dist(start), 3);
  });

  it("swiping up and down with two fingers tips the model", () => {
    const { controller, log } = build();
    controller.down(finger(1, 350, 300, 0));
    controller.down(finger(2, 450, 300, 5));
    for (let i = 1; i <= 8; i++) {
      controller.move(finger(1, 350, 300 + i * 12, 10 + i * 10));
      controller.move(finger(2, 450, 300 + i * 12, 10 + i * 10));
    }
    expect(log.pose.eye[1]).toBeGreaterThan(start.eye[1]);
  });

  it("spreading the fingers zooms in and bringing them together zooms out", () => {
    const dist = (p: Pose) => Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]);
    const a = build();
    a.controller.down(finger(1, 350, 300, 0));
    a.controller.down(finger(2, 450, 300, 5));
    a.controller.move(finger(1, 300, 300, 20));
    a.controller.move(finger(2, 500, 300, 25));
    expect(dist(a.log.pose)).toBeLessThan(dist(start) * 0.6);
    const b = build();
    b.controller.down(finger(1, 300, 300, 0));
    b.controller.down(finger(2, 500, 300, 5));
    b.controller.move(finger(1, 350, 300, 20));
    b.controller.move(finger(2, 450, 300, 25));
    expect(dist(b.log.pose)).toBeGreaterThan(dist(start) * 1.6);
  });

  it("twisting alone does nothing; only swipe and spread act", () => {
    const { controller, log } = build();
    controller.down(finger(1, 300, 300, 0));
    controller.down(finger(2, 500, 300, 5));
    const before = log.pose;
    controller.move(finger(1, 306, 280, 20));
    controller.move(finger(2, 494, 320, 25));
    expect(eyeAngle(log.pose)).toBeCloseTo(eyeAngle(before), 3);
  });

  it("lifting one finger of a pinch carries on sliding with the other, without a jump", () => {
    const { controller, log } = build();
    controller.down(finger(1, 300, 300, 0));
    controller.down(finger(2, 500, 300, 5));
    controller.move(finger(2, 520, 300, 20));
    controller.up(finger(1, 300, 300, 30));
    expect(controller.pointerCount).toBe(1);
    expect(controller.mode).toBe("slide");
    const held = log.pose;
    controller.move(finger(2, 520, 300, 40));
    for (let i = 0; i < 3; i++) expect(log.pose.eye[i]).toBeCloseTo(held.eye[i]!, 4);
    controller.move(finger(2, 620, 300, 60));
    expect(log.pose.eye[0]).not.toBeCloseTo(held.eye[0]!, 1);
  });

  it("never gets stuck: a cancelled pointer, then a fresh touch, still moves the camera", () => {
    const { controller, log } = build();
    controller.down(finger(1, 300, 300, 0));
    controller.down(finger(2, 500, 300, 5));
    controller.cancel(1);
    controller.cancel(2);
    expect(controller.mode).toBe("idle");
    expect(controller.pointerCount).toBe(0);
    controller.down(finger(3, 400, 300, 100));
    controller.move(finger(3, 500, 300, 120));
    controller.move(finger(3, 600, 300, 140));
    expect(log.pose).not.toBe(start);
  });

  it("ignores a third finger instead of scrambling the pinch", () => {
    const { controller } = build();
    controller.down(finger(1, 300, 300, 0));
    controller.down(finger(2, 500, 300, 5));
    controller.down(finger(3, 400, 100, 8));
    expect(controller.pointerCount).toBe(2);
  });

  it("coasts after a flick and then stops", () => {
    const { controller, log } = build();
    const mouse = (x: number, time: number) => ({ id: 1, x, y: 300, time, type: "mouse" as const, button: 2 });
    controller.down(mouse(300, 0));
    for (let i = 1; i <= 6; i++) controller.move(mouse(300 + i * 30, i * 10));
    controller.up(mouse(480, 65));
    const released = eyeAngle(log.pose);
    let frames = 0;
    while (controller.tick(16) && frames < 600) frames++;
    expect(eyeAngle(log.pose)).not.toBeCloseTo(released, 2);
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(600);
  });

  it("does not coast after holding still", () => {
    const { controller } = build();
    controller.down(finger(1, 300, 300, 0));
    for (let i = 1; i <= 6; i++) controller.move(finger(1, 300 + i * 30, 300, i * 10));
    controller.up(finger(1, 480, 300, 400));
    expect(controller.tick(16)).toBe(false);
  });

  it("mouse: left drag moves the floor with the cursor, right drag turns, and neither jumps", () => {
    const move = build();
    move.controller.down({ id: 1, x: 400, y: 300, time: 0, type: "mouse", button: 0 });
    const point = pointUnderCursor(start, { x: 400, y: 300 }, viewport, 45, [0, 0, 0]);
    move.controller.move({ id: 1, x: 460, y: 300, time: 20, type: "mouse" });
    move.controller.move({ id: 1, x: 520, y: 340, time: 40, type: "mouse" });
    // It moves the view without turning it, keeps its height, and the grabbed spot follows the cursor.
    expect(eyeAngle(move.log.pose)).toBeCloseTo(eyeAngle(start), 5);
    expect(move.log.pose.eye[1]).toBeCloseTo(start.eye[1], 6);
    const now = world(move.log.pose, point);
    expect(Math.hypot(now.x - 520, now.y - 340)).toBeLessThan(2);

    const turn = build();
    turn.controller.down({ id: 1, x: 400, y: 300, time: 0, type: "mouse", button: 2 });
    turn.controller.move({ id: 1, x: 500, y: 300, time: 20, type: "mouse" });
    turn.controller.move({ id: 1, x: 600, y: 300, time: 40, type: "mouse" });
    expect(eyeAngle(turn.log.pose)).not.toBeCloseTo(eyeAngle(start), 2);

    const shift = build();
    shift.controller.down({ id: 1, x: 400, y: 300, time: 0, type: "mouse", button: 0, shift: true });
    shift.controller.move({ id: 1, x: 500, y: 300, time: 20, type: "mouse" });
    shift.controller.move({ id: 1, x: 600, y: 300, time: 40, type: "mouse" });
    expect(eyeAngle(shift.log.pose)).not.toBeCloseTo(eyeAngle(start), 2);
  });

  it("the wheel zooms towards the cursor", () => {
    const { controller, log } = build();
    const point = pointUnderCursor(start, { x: 200, y: 150 }, viewport, 45, [0, 0, 0]);
    controller.wheel({ deltaY: -100, deltaMode: 0, ctrlKey: false, x: 200, y: 150 });
    const after = world(log.pose, point);
    expect(Math.hypot(after.x - 200, after.y - 150)).toBeLessThan(2);
    expect(log.pose.eye[1]).toBeLessThan(start.eye[1]);
  });

  it("cannot be thrown out of sight", () => {
    const { controller, log } = build();
    controller.down({ id: 1, x: 400, y: 300, time: 0, type: "mouse", button: 0 });
    controller.move({ id: 1, x: 400, y: 320, time: 20, type: "mouse" });
    controller.move({ id: 1, x: 5000, y: -4000, time: 40, type: "mouse" });
    expect(Math.hypot(log.pose.target[0], log.pose.target[2])).toBeLessThanOrEqual(60 * 1.1 + 1e-6);
  });
});

describe("panning a tilted view", () => {
  const viewport = { width: 800, height: 600 };
  it("never lets a drag near the horizon hurl the camera across the map", () => {
    const pose: Pose = { eye: [0, 2, 60], target: [0, 1.9, 0] };
    const out = panOnPlane(pose, [0, 0, 0], { x: 400, y: 300 }, { x: 400, y: 150 }, viewport, 45);
    expect(Math.hypot(out.eye[0] - pose.eye[0], out.eye[2] - pose.eye[2])).toBeLessThan(60 * 10);
  });

  it("leaves the pose alone when the ray points away from the floor", () => {
    const pose: Pose = { eye: [0, 40, 60], target: [0, 0, 0] };
    // Far above the horizon the cursor's ray never meets the floor.
    expect(panOnPlane(pose, [0, 0, 0], { x: 400, y: 300 }, { x: 400, y: -4000 }, viewport, 45)).toBe(pose);
  });
});

describe("gesture maths", () => {
  const viewport = { width: 800, height: 600 };
  const pose: Pose = { eye: [0, 40, 50], target: [0, 0, 0] };
  const base = { pose, pivot: [0, 0, 0] as Vec3, viewport, fovDegrees: 45, limits: { min: 2, max: 300 } };
  const at = (x: number, y: number, spread = 100, angle = 0): Touchpoint => ({ x, y, spread, angle });

  it("does nothing when the fingers have not moved", () => {
    const out = gesturePose(base, at(400, 300), at(400, 300));
    for (let i = 0; i < 3; i++) {
      expect(out.eye[i]).toBeCloseTo(pose.eye[i]!, 6);
      expect(out.target[i]).toBeCloseTo(pose.target[i]!, 6);
    }
  });

  it("respects the distance limits however far the fingers spread", () => {
    const out = gesturePose(base, at(400, 300, 10), at(400, 300, 100000));
    expect(Math.hypot(out.eye[0] - out.target[0], out.eye[1] - out.target[1], out.eye[2] - out.target[2])).toBeGreaterThanOrEqual(2 - 1e-6);
  });

  it("clampPose leaves a pose that is already in range alone", () => {
    expect(clampPose(pose, [0, 0, 0], 60)).toBe(pose);
  });
});

describe("staying put", () => {
  const viewport = { width: 800, height: 600 };
  it("never moves the camera on its own", () => {
    const state = { pose: { eye: [60, 90, 120], target: [40, 0, 10] } as Pose };
    const c = createController({
      getPose: () => state.pose,
      setPose: (p) => (state.pose = p),
      viewport: () => viewport,
      fovDegrees: 45,
      limits: () => ({ min: 2, max: 400 }),
      centre: [0, 8, 0],
      radius: 60,
      onTakeover: () => {},
      animateTo: () => {},
    });
    c.wheel({ deltaY: 0, deltaMode: 0, ctrlKey: false, x: 400, y: 300 });
    const afterWheel = state.pose;
    for (let i = 0; i < 300; i++) c.tick(16);
    expect(state.pose).toBe(afterWheel);
  });
});

describe("running out of tilt", () => {
  const viewport = { width: 800, height: 600 };
  it("keeps following the finger: the model slides up when dragged up past level", () => {
    const state = { pose: { eye: [0, 3, 80], target: [0, 0, 0] } as Pose };
    const c = createController({
      getPose: () => state.pose,
      setPose: (p) => (state.pose = p),
      viewport: () => viewport,
      fovDegrees: 45,
      limits: () => ({ min: 2, max: 400 }),
      centre: [0, 0, 0],
      radius: 60,
      onTakeover: () => {},
      animateTo: () => {},
    });
    const before = projectToScreen(state.pose, [0, 0, 0], viewport, 45).y;
    c.down({ id: 1, x: 400, y: 500, time: 0, type: "mouse", button: 2 });
    for (let i = 1; i <= 20; i++) c.move({ id: 1, x: 400, y: 500 - i * 10, time: i * 16, type: "mouse" });
    c.up({ id: 1, x: 400, y: 300, time: 2000, type: "mouse" });
    const after = projectToScreen(state.pose, [0, 0, 0], viewport, 45).y;
    expect(after).toBeLessThan(before - 20);
  });
});

describe("scroll on a trackpad", () => {
  const viewport = { width: 800, height: 600 };
  const make = () => {
    const state = { pose: { eye: [0, 40, 60], target: [0, 0, 0] } as Pose };
    const c = createController({
      getPose: () => state.pose,
      setPose: (p) => (state.pose = p),
      viewport: () => viewport,
      fovDegrees: 45,
      limits: () => ({ min: 2, max: 400 }),
      centre: [0, 0, 0],
      radius: 80,
      onTakeover: () => {},
      animateTo: () => {},
    });
    return { state, c };
  };
  const dist = (p: Pose) => Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]);
  const swipe = (deltaX: number, deltaY: number, at: number) => ({ deltaX, deltaY, deltaMode: 0, ctrlKey: false, x: 400, y: 300, timeStamp: at });

  it("a swipe slides the model with the fingers and never zooms", () => {
    const { state, c } = make();
    const d0 = dist(state.pose);
    const y0 = projectToScreen(state.pose, [0, 0, 0], viewport, 45).y;
    for (let i = 0; i < 6; i++) c.wheel(swipe(0, 3.5, i * 16));
    expect(dist(state.pose)).toBeCloseTo(d0, 3);
    // Fingers up (positive delta) carry the model up the screen.
    expect(projectToScreen(state.pose, [0, 0, 0], viewport, 45).y).toBeLessThan(y0 - 5);
  });

  it("sideways swipes slide sideways", () => {
    const { state, c } = make();
    const x0 = projectToScreen(state.pose, [0, 0, 0], viewport, 45).x;
    for (let i = 0; i < 6; i++) c.wheel(swipe(4.5, 0.5, i * 16));
    expect(projectToScreen(state.pose, [0, 0, 0], viewport, 45).x).toBeLessThan(x0 - 5);
  });

  it("a pinch still zooms", () => {
    const { state, c } = make();
    const d0 = dist(state.pose);
    c.wheel({ deltaX: 0, deltaY: -8, deltaMode: 0, ctrlKey: true, x: 400, y: 300, timeStamp: 0 });
    expect(dist(state.pose)).toBeLessThan(d0);
  });
});

describe("flying to a room", () => {
  it("looks at the room from behind its label, so the number reads the right way up", () => {
    for (const axis of [0, 0.4, -1.2, 1.5]) {
      const pose = roomPose([10, 3, -4], 8, axis);
      const forward = [pose.target[0] - pose.eye[0], pose.target[2] - pose.eye[2]];
      const length = Math.hypot(forward[0]!, forward[1]!);
      // The label's own "up" on the floor (see LevelMesh: rotation [-PI/2, 0, axis]).
      expect(forward[0]! / length).toBeCloseTo(-Math.sin(axis), 5);
      expect(forward[1]! / length).toBeCloseTo(-Math.cos(axis), 5);
      expect(pose.eye[1]).toBeGreaterThan(pose.target[1]);
    }
  });

  it("stands further back for a big room than a small one, within limits", () => {
    const dist = (size: number) => {
      const p = roomPose([0, 0, 0], size, 0);
      return Math.hypot(p.eye[0], p.eye[1], p.eye[2]);
    };
    expect(dist(40)).toBeGreaterThan(dist(4));
    expect(dist(1000)).toBeLessThan(120);
  });
});
