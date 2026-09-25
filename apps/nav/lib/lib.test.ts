import { Building, Level } from "@wf/schema";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildGraph } from "@wf/routing";
import { describe, expect, it } from "vitest";
import type { BuildingData } from "./data";
import { boundsOf, cameraFor, contrastRatio, labelColor, legendEntries, levelHeights, planToShape, routePoints, shapeToScene, toScene, CATEGORY_COLOR } from "./scene";
import { interiorPoint, pointInPolygon } from "@wf/geometry";
import { route } from "@wf/routing";
import { stepPose } from "./camera";
import { alphaAt, locateStep, routeGeometry } from "./route-geometry";
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

    // The last point sits inside room 315 rather than out at its door.
    const last = geometry.ribbons[geometry.ribbons.length - 1]!;
    const end = last.points[last.points.length - 1]!;
    const room = data.graph.rooms.get("wheeler-L3-r315")!;
    expect(pointInPolygon([end[0], -end[2]], room.polygon)).toBe(true);
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
