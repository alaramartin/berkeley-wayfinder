import { Building, Level } from "@wf/schema";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildGraph } from "@wf/routing";
import { describe, expect, it } from "vitest";
import type { BuildingData } from "./data";
import { boundsOf, cameraFor, levelHeights, routePoints, toScene } from "./scene";
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
