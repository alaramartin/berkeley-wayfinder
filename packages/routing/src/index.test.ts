import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Building, type Level as LevelType, Level } from "@wf/schema";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";
import { instructions, summary } from "./instructions";
import { nearest } from "./nearest";
import { WALK_SPEED_MPS, route } from "./route";

/** Two floors: a corridor with rooms 101/102, a stair and an elevator up to 201. */
function fixture(): { building: Building; levels: LevelType[] } {
  const level = (id: string, sortIndex: number, elevationM: number, rooms: LevelType["rooms"]): LevelType =>
    Level.parse({
      id,
      buildingId: "test",
      sortIndex,
      displayName: id,
      elevationM,
      heightM: 4,
      heightSource: "default",
      outline: [
        [0, 0],
        [40, 0],
        [40, 20],
        [0, 20],
      ],
      imageTransform: { scale: 1, rotation: 0, tx: 0, ty: 0 },
      nodes: [
        { id: `${id}-n1`, levelId: id, x: 0, y: 0, kind: "entrance" },
        { id: `${id}-n2`, levelId: id, x: 40, y: 0, kind: "junction" },
        { id: `${id}-stair`, levelId: id, x: 40, y: 10, kind: "stair" },
        { id: `${id}-lift`, levelId: id, x: 20, y: 10, kind: "elevator" },
      ],
      edges: [
        { id: `${id}-e1`, a: `${id}-n1`, b: `${id}-n2`, kind: "corridor", accessible: true, polyline: [[0, 0], [40, 0]] },
        { id: `${id}-e2`, a: `${id}-n2`, b: `${id}-stair`, kind: "corridor", accessible: true, polyline: [[40, 0], [40, 10]] },
        { id: `${id}-e3`, a: `${id}-n1`, b: `${id}-lift`, kind: "corridor", accessible: true, polyline: [[0, 0], [20, 10]] },
      ],
      rooms,
      pois: rooms.filter((r) => r.category === "restroom").map((r) => ({ id: `${r.id}-poi`, kind: "restroom", levelId: id, roomId: r.id })),
    });

  const l1 = level("L1", 1, 0, [
    {
      id: "r101",
      number: "101",
      category: "classroom",
      levelId: "L1",
      aliases: [],
      polygon: [
        [5, 2],
        [15, 2],
        [15, 8],
        [5, 8],
      ],
      doors: [{ edgeId: "L1-e1", t: 0.25, side: "left", verified: false }],
    },
    {
      id: "r102",
      number: "102",
      category: "restroom",
      name: "Restroom",
      levelId: "L1",
      aliases: [],
      restroom: { gender: "all", accessible: true },
      polygon: [
        [25, 2],
        [35, 2],
        [35, 8],
        [25, 8],
      ],
      doors: [{ edgeId: "L1-e1", t: 0.75, side: "left", verified: false }],
    },
  ]);
  const l2 = level("L2", 2, 4, [
    {
      id: "r201",
      number: "201",
      category: "office",
      levelId: "L2",
      aliases: [],
      polygon: [
        [5, 2],
        [15, 2],
        [15, 8],
        [5, 8],
      ],
      doors: [{ edgeId: "L2-e1", t: 0.5, side: "right", verified: false }],
    },
  ]);

  const building = Building.parse({
    id: "test",
    name: "Test Hall",
    osmWayId: null,
    origin: null,
    footprint: [
      [0, 0],
      [40, 0],
      [40, 20],
      [0, 20],
    ],
    levels: [
      { id: "L1", sortIndex: 1 },
      { id: "L2", sortIndex: 2 },
    ],
    shafts: [
      { id: "test-shaft-s1", kind: "stair", nodeIds: ["L1-stair", "L2-stair"] },
      { id: "test-shaft-v1", kind: "elevator", nodeIds: ["L1-lift", "L2-lift"] },
    ],
    entrances: [
      { id: "test-x1", nodeId: "L1-n1", name: "Main entrance", accessible: true },
    ],
  });
  return { building, levels: [l1, l2] };
}

describe("routing on a fixture", () => {
  const { building, levels } = fixture();
  const graph = buildGraph(building, levels);

  it("splits corridor edges at doors and walks to a room on the same floor", () => {
    const r = route(graph, { type: "entrance", id: "test-x1" }, { type: "room", id: "r101" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The door sits a quarter along the 40 m corridor.
    expect(r.route.meters).toBeCloseTo(10, 5);
    expect(r.route.seconds).toBeCloseTo(10 / WALK_SPEED_MPS, 5);
    expect(r.route.levelIds).toEqual(["L1"]);
  });

  it("uses the stairs between floors, and the elevator when accessible is on", () => {
    const stairs = route(graph, { type: "room", id: "r101" }, { type: "room", id: "r201" });
    expect(stairs.ok).toBe(true);
    if (stairs.ok) expect(stairs.route.steps.some((s) => s.edge.kind === "stair")).toBe(true);

    const step_free = route(graph, { type: "room", id: "r101" }, { type: "room", id: "r201" }, { accessible: true });
    expect(step_free.ok).toBe(true);
    if (!step_free.ok) return;
    expect(step_free.route.steps.some((s) => s.edge.kind === "stair")).toBe(false);
    expect(step_free.route.steps.some((s) => s.edge.kind === "elevator")).toBe(true);
    expect(step_free.route.levelIds).toEqual(["L1", "L2"]);
  });

  it("finds the nearest restroom", () => {
    const found = nearest(graph, { type: "room", id: "r101" }, "restroom");
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.roomId).toBe("r102");
  });

  it("explains an unreachable destination", () => {
    // No shafts at all: L2 keeps its rooms and corridors but nothing reaches it.
    const cut = buildGraph({ ...building, shafts: [] }, levels);
    const r = route(cut, { type: "room", id: "r101" }, { type: "room", id: "r201" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not connected/);
  });

  it("says when only the accessible route is missing", () => {
    const noLift = buildGraph({ ...building, shafts: building.shafts.filter((s) => s.kind === "stair") }, levels);
    const r = route(noLift, { type: "room", id: "r101" }, { type: "room", id: "r201" }, { accessible: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/There is a route using stairs/);
  });

  it("refuses locked edges and card edges unless asked", () => {
    const locked = buildGraph(
      building,
      levels.map((l) => (l.id === "L1" ? { ...l, edges: l.edges.map((e) => (e.id === "L1-e1" ? { ...e, access: "card" as const } : e)) } : l)),
    );
    expect(route(locked, { type: "entrance", id: "test-x1" }, { type: "room", id: "r102" }).ok).toBe(false);
    expect(route(locked, { type: "entrance", id: "test-x1" }, { type: "room", id: "r102" }, { allowCard: true }).ok).toBe(true);
  });

  it("writes instructions with distances, landmarks and a vertical step", () => {
    const r = route(graph, { type: "entrance", id: "test-x1" }, { type: "room", id: "r201" }, { accessible: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const steps = instructions(graph, r.route);
    const text = steps.map((s) => s.text).join("\n");
    expect(steps[0]!.text).toMatch(/Start at Main entrance/);
    expect(text).toMatch(/about \d+ m|a few steps/);
    expect(text).toMatch(/Take the elevator up to Level L2/);
    expect(steps[steps.length - 1]!.text).toMatch(/Arrive at 201/);
    // Distances stay vague and the unconfirmed door is called out.
    expect(text).not.toMatch(/\d+\.\d+ m/);
    expect(text).toMatch(/door position is unconfirmed/);
    expect(summary(r.route)).toMatch(/·/);
  });
});

describe("instruction wording", () => {
  const { building, levels } = fixture();
  const graph = buildGraph(building, levels);

  it("does not say 'Walk and walk', and merges flights in one shaft", () => {
    const r = route(graph, { type: "room", id: "r101" }, { type: "room", id: "r201" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = instructions(graph, r.route).map((s) => s.text);
    expect(text.join("\n")).not.toMatch(/Walk and walk/);
    expect(text.filter((t) => /Take the stairs/.test(t))).toHaveLength(1);
  });

  it("says which way to face, and never uses compass directions", () => {
    const r = route(graph, { type: "room", id: "r101" }, { type: "room", id: "r201" }, { accessible: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = instructions(graph, r.route)
      .map((s) => s.text)
      .join("\n");
    // Leaving a room we know which way you face, so the first move is a turn.
    expect(text).toMatch(/Leave 101 and (turn|bear) (left|right)|Leave 101 and walk straight ahead/);
    // Stepping out of a lift there is no such reference, so point at something instead.
    expect(text).toMatch(/Leave the elevator and walk/);
    expect(text).not.toMatch(/north|south|east|west/i);
  });

  it("asking for a restroom also finds the accessible and all-gender ones", () => {
    // Wheeler's restrooms are tagged accessible-restroom, which a plain "restroom" search must still find.
    const tagged = levels.map((l) =>
      l.id === "L1" ? { ...l, pois: l.pois.map((p) => (p.kind === "restroom" ? { ...p, kind: "accessible-restroom" as const } : p)) } : l,
    );
    const g = buildGraph(building, tagged);
    const found = nearest(g, { type: "room", id: "r101" }, "restroom");
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.roomId).toBe("r102");
  });
});

describe("routing on real Wheeler data", () => {
  const root = path.resolve(import.meta.dirname, "../../../data/buildings/wheeler");

  async function load() {
    const building = Building.parse(JSON.parse(await readFile(path.join(root, "building.json"), "utf8")));
    const files = await readdir(path.join(root, "levels"));
    const levels = await Promise.all(
      files.filter((f: string) => f.endsWith(".json")).map(async (f: string) => Level.parse(JSON.parse(await readFile(path.join(root, "levels", f), "utf8")))),
    );
    return buildGraph(building, levels);
  }

  it("routes between rooms on one floor", async () => {
    const graph = await load();
    const r = route(graph, { type: "room", id: "wheeler-L1-r100" }, { type: "room", id: "wheeler-L1-r130" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.route.levelIds).toEqual(["L1"]);
    expect(r.route.meters).toBeGreaterThan(5);
  });

  it("routes between floors and can be forced onto the elevator", async () => {
    const graph = await load();
    const stairs = route(graph, { type: "room", id: "wheeler-L1-r120" }, { type: "room", id: "wheeler-L3-r315" });
    expect(stairs.ok).toBe(true);
    if (stairs.ok) expect(stairs.route.levelIds[0]).toBe("L1");

    const stepFree = route(graph, { type: "room", id: "wheeler-L1-r120" }, { type: "room", id: "wheeler-L3-r315" }, { accessible: true });
    expect(stepFree.ok).toBe(true);
    if (!stepFree.ok) return;
    expect(stepFree.route.steps.some((s) => s.edge.kind === "stair")).toBe(false);
    expect(stepFree.route.steps.some((s) => s.edge.kind === "elevator")).toBe(true);
  });

  it("routes from an entrance and finds the nearest restroom", async () => {
    const graph = await load();
    const entrance = graph.building.entrances[0]!;
    const fromDoor = route(graph, { type: "entrance", id: entrance.id }, { type: "room", id: "wheeler-L1-r130" });
    expect(fromDoor.ok).toBe(true);

    const loo = nearest(graph, { type: "room", id: "wheeler-L1-r150" }, "restroom");
    expect(loo.ok).toBe(true);
    if (loo.ok) expect(graph.rooms.get(loo.roomId!)?.category).toBe("restroom");
  });

  it("keeps the nearest restroom on the same floor when there is one", async () => {
    const graph = await load();
    const found = nearest(graph, { type: "room", id: "wheeler-L1-r108" }, "restroom");
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.route.levelIds).toEqual(["L1"]);
  });

  it("puts every room node inside its own room, with no door teleports", async () => {
    const graph = await load();
    const { pointInPolygon } = await import("@wf/geometry");
    const outside: string[] = [];
    for (const [id, node] of graph.nodes) {
      if (node.kind !== "room" || !node.roomId) continue;
      const room = graph.rooms.get(node.roomId)!;
      if (!pointInPolygon([node.x, node.y], room.polygon)) outside.push(id);
    }
    expect(outside).toEqual([]);

    // The old bug hopped from the arrival door to some *other* door of the same room, up to 16 m
    // away and outside the room entirely. Every doorway hop must now finish inside the room it enters.
    const strays: string[] = [];
    for (const edges of graph.adjacency.values()) {
      for (const edge of edges) {
        if (edge.kind !== "doorway") continue;
        const target = graph.nodes.get(edge.to);
        if (target?.kind !== "room" || !target.roomId) continue;
        const room = graph.rooms.get(target.roomId)!;
        const end = edge.polyline[edge.polyline.length - 1]!;
        if (!pointInPolygon(end, room.polygon)) strays.push(edge.id);
      }
    }
    expect(strays).toEqual([]);
  });

  it("routes to a room entered through another room, and names it", async () => {
    const graph = await load();
    // B 31A is entered through 31; L4 420 sits behind a chain (420 -> 419 -> 418).
    for (const id of ["wheeler-B-r31A", "wheeler-L4-r420"]) {
      const room = graph.rooms.get(id)!;
      expect(room.enteredVia).toBeTruthy();
      const r = route(graph, { type: "entrance", id: graph.building.entrances[0]!.id }, { type: "room", id });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const end = r.route.nodes[r.route.nodes.length - 1]!;
      expect(end.roomId).toBe(id);
      const text = instructions(graph, r.route).map((s) => s.text).join("\n");
      expect(text).toMatch(new RegExp(`Arrive at ${room.number}`));
      expect(text).toMatch(/which is inside/);
    }
  });

  it("attaches every stair and lift to the corridor beside it, not a junction further along", async () => {
    // A lift linked to a far junction sends routes walking there and doubling back: on L3 the lift was
    // 3.6 m from room 315 and the route 10.5 m, with two turns. The link should be about as short as
    // the distance to the nearest other corridor.
    const graph = await load();
    const offenders: string[] = [];
    for (const level of graph.levels.values()) {
      const nodes = new Map(level.nodes.map((n) => [n.id, n]));
      const line = (e: (typeof level.edges)[number]): [number, number][] => e.polyline ?? [[nodes.get(e.a)!.x, nodes.get(e.a)!.y], [nodes.get(e.b)!.x, nodes.get(e.b)!.y]];
      const length = (pts: [number, number][]) => pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1])), 0);
      const distanceTo = (n: { x: number; y: number }, pts: [number, number][]) => {
        let best = Number.POSITIVE_INFINITY;
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1]!;
          const [bx, by] = pts[i]!;
          const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
          const u = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((n.x - ax) * (bx - ax) + (n.y - ay) * (by - ay)) / l2));
          best = Math.min(best, Math.hypot(n.x - (ax + (bx - ax) * u), n.y - (ay + (by - ay) * u)));
        }
        return best;
      };
      for (const node of level.nodes) {
        if (node.kind !== "stair" && node.kind !== "elevator") continue;
        const own = level.edges.filter((e) => e.a === node.id || e.b === node.id);
        if (own.length !== 1) continue;
        const linkLength = length(line(own[0]!));
        const nearest = Math.min(...level.edges.filter((e) => e !== own[0]).map((e) => distanceTo(node, line(e))));
        if (linkLength - nearest > 1.5 && nearest < linkLength * 0.7) offenders.push(`${node.id}: link ${linkLength.toFixed(1)} m, corridor ${nearest.toFixed(1)} m away`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("goes straight from the lift to a door three metres away", async () => {
    const graph = await load();
    const r = route(graph, { type: "room", id: "wheeler-L1-r120" }, { type: "room", id: "wheeler-L3-r315" }, { accessible: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Was 21.1 m, walking west to a junction and back; the lift and the door are 3.6 m apart.
    expect(r.route.meters).toBeLessThan(17);
    expect(instructions(graph, r.route).map((i) => i.text).join("\n")).not.toMatch(/Turn sharply right/);
  });

  it("gives every room a door or a host room", async () => {
    const graph = await load();
    const orphans = [...graph.rooms.values()].filter(
      (r) => !["stair", "elevator", "service"].includes(r.category) && !graph.roomDoors.get(r.id)?.length && !r.enteredVia,
    );
    expect(orphans.map((r) => r.number ?? r.id)).toEqual([]);
  });
});
