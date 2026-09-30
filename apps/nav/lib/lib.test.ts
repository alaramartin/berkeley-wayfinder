import { Building, Level } from "@wf/schema";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildGraph } from "@wf/routing";
import { describe, expect, it } from "vitest";
import type { BuildingData } from "./data";
import type { Vec3 } from "./scene";
import { boundsOf, cameraFor, contrastRatio, labelColor, legendEntries, levelHeights, planToShape, routePoints, shapeToScene, toScene, CATEGORY_COLOR } from "./scene";
import { interiorPoint, pointInPolygon } from "@wf/geometry";
import { route } from "@wf/routing";
import { type Grab, grabRotate, projectToScreen, stepPose } from "./camera";
import { createWheelRouter } from "./input";
import { alphaAt, locateStep, routeGeometry } from "./route-geometry";
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

  it("frames a step from behind, looking the way you walk", async () => {
    const data = await wheeler();
    const found = route(data.graph, { type: "room", id: "wheeler-L1-r120" }, { type: "room", id: "wheeler-L1-r130" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const geometry = routeGeometry(found.route);
    const at = locateStep(geometry, 1);
    expect(at).not.toBeNull();
    if (!at) return;

    const pose = stepPose(at.ribbon, at.pointIndex, 0);
    const here = at.ribbon.points[at.pointIndex]!;
    // Eye above the floor and behind the walker; the target is further along than the eye.
    expect(pose.eye[1]).toBeGreaterThan(here[1] + 2);
    const eyeToHere = Math.hypot(here[0] - pose.eye[0], here[2] - pose.eye[2]);
    const eyeToTarget = Math.hypot(pose.target[0] - pose.eye[0], pose.target[2] - pose.eye[2]);
    expect(eyeToTarget).toBeGreaterThan(eyeToHere);
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
  const grab: Grab = {
    pose: { eye: [40, 30, 40], target: [0, 0, 0] },
    pivot: [0, 0, 0],
    cursor: { x: 600, y: 400 },
    viewport,
    fovDegrees: 45,
  };

  it("keeps the grabbed point under the cursor", () => {
    for (const [dx, dy] of [
      [120, 0],
      [-200, 40],
      [0, 90],
      [-340, -120],
      [500, 60],
    ]) {
      const cursor = { x: grab.cursor.x + dx!, y: grab.cursor.y + dy! };
      const pose = grabRotate(grab, cursor);
      const back = projectToScreen(pose, grab.pivot, viewport, grab.fovDegrees);
      expect(Math.hypot(back.x - cursor.x, back.y - cursor.y)).toBeLessThan(2);
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

  it("does nothing when the cursor has not moved", () => {
    const pose = grabRotate(grab, grab.cursor);
    for (let i = 0; i < 3; i++) {
      expect(pose.eye[i]).toBeCloseTo(grab.pose.eye[i]!, 6);
      expect(pose.target[i]).toBeCloseTo(grab.pose.target[i]!, 6);
    }
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
