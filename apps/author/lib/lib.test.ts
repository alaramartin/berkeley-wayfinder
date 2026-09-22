import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Proposal, ReviewQueue, type Level, type ReviewItem } from "@wf/schema";
import { acceptBlockers, proposalToLevel } from "./accept";
import { addEdge, components, deleteNode, doorPoint, moveNode, projectToGraph, setDoor, splitEdge } from "./graph";
import { area, splitPolygon } from "./polygon";
import { applyAnswer } from "./review";
import { proposeShafts, shaftToGraph } from "./shafts";

const ROOT = join(__dirname, "..", "..", "..");

function tiny(): Proposal {
  return Proposal.parse({
    buildingId: "test",
    levelId: "L1",
    imageSize: [1000, 1000],
    generatedAt: "now",
    pipelineVersion: "t",
    outline: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]],
    nodes: [
      { id: "test-L1-n001", x: 100, y: 500, kind: "junction", confidence: 1 },
      { id: "test-L1-n002", x: 900, y: 500, kind: "junction", confidence: 1 },
      { id: "test-L1-n003", x: 500, y: 900, kind: "junction", confidence: 1 },
    ],
    edges: [{ id: "test-L1-e001", a: "test-L1-n001", b: "test-L1-n002", kind: "corridor", polyline: [[100, 500], [900, 500]], confidence: 1 }],
    rooms: [
      {
        id: "test-L1-r101",
        regionId: "test-L1-g001",
        number: "101",
        numberConfidence: 1,
        category: "classroom",
        group: "Classrooms",
        polygon: [[100, 300], [500, 300], [500, 480], [100, 480]],
        doors: [{ edgeId: "test-L1-e001", t: 0.75, side: "left", confidence: 0.5 }],
      },
      { id: "test-L1-g002", regionId: "test-L1-g002", number: null, numberConfidence: 0, category: "restroom", group: null, polygon: [[600, 520], [800, 520], [800, 700], [600, 700]], doors: [] },
    ],
    icons: [{ id: "test-L1-i001", kind: "dwa", at: [150, 520], confidence: 0.8 }],
  });
}

describe("graph editing", () => {
  it("splits an edge and keeps doors at the same physical spot", () => {
    const p = tiny();
    const before = doorPoint(p, p.rooms[0]!.doors[0]!)!;
    const { proposal, nodeId } = splitEdge(p, "test-L1-e001", [300, 520]);
    expect(proposal.edges).toHaveLength(2);
    expect(proposal.nodes.find((n) => n.id === nodeId)).toMatchObject({ x: 300, y: 500 });
    const after = doorPoint(proposal, proposal.rooms[0]!.doors[0]!)!;
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it("joins components and deletes cleanly", () => {
    let p = tiny();
    expect(components(p)).toHaveLength(2);
    p = addEdge(p, "test-L1-n002", "test-L1-n003");
    expect(components(p)).toHaveLength(1);
    p = moveNode(p, "test-L1-n003", [880, 880]);
    expect(p.edges.at(-1)!.polyline.at(-1)).toEqual([880, 880]);
    p = deleteNode(p, "test-L1-n001");
    expect(p.edges.map((e) => e.id)).not.toContain("test-L1-e001");
    expect(p.rooms[0]!.doors).toHaveLength(0);
  });

  it("projects with map-oriented sides and places doors", () => {
    const p = tiny();
    expect(projectToGraph(p, [500, 400])!.side).toBe("left"); // north of an eastbound corridor
    const withDoor = setDoor(p, "test-L1-g002", [700, 530]);
    const d = withDoor.rooms[1]!.doors[0]!;
    expect(d.side).toBe("right");
    expect(d.t).toBeCloseTo(0.75);
  });
});

describe("polygon split", () => {
  it("splits a suite in two along a line", () => {
    const suite: [number, number][] = [[0, 0], [300, 0], [300, 100], [0, 100]];
    const parts = splitPolygon(suite, [100, -10], [100, 110])!;
    expect(parts).not.toBeNull();
    expect(area(parts[0]) + area(parts[1])).toBeCloseTo(30000);
    expect(Math.min(area(parts[0]), area(parts[1]))).toBeCloseTo(10000);
    expect(splitPolygon(suite, [400, 0], [400, 100])).toBeNull();
  });
});

describe("review answers", () => {
  const item = (kind: ReviewItem["kind"], targetId: string, value = ""): ReviewItem => ({ id: `${targetId}-x`, kind, crop: "", candidates: value ? [{ value, confidence: 0.5 }] : [], targetId });

  it("numbers an unnumbered region and adds suite rooms", () => {
    const p = tiny();
    const a = applyAnswer(p, item("room-number", "test-L1-g002"), { value: "105" }).proposal;
    expect(a.rooms.find((r) => r.number === "105")?.id).toBe("test-L1-r105");
    const b = applyAnswer(p, item("room-number", "test-L1-g001"), { value: "101a" }).proposal;
    expect(b.rooms.filter((r) => r.regionId === "test-L1-g001").map((r) => r.number).sort()).toEqual(["101", "101A"]);
    const dup = applyAnswer(p, item("room-number", "test-L1-g002"), { value: "101" });
    expect(dup.conflict).toMatch(/already exists/);
    const missing = applyAnswer(p, item("room-number", "test-L1-g999"), { value: "31" });
    expect(missing.conflict).toMatch(/no room/);
    expect(missing.item.resolved).toBeUndefined();
    expect(dup.item.resolved).toBeUndefined();
    const c = applyAnswer(p, item("room-number", "test-L1-g002"), { value: null });
    expect(c.proposal.rooms).toHaveLength(1);
    expect(c.item.resolved?.value).toBeNull();
  });

  it("sets restroom gender and name; edits aliases; rejects icons", () => {
    const p = { ...tiny(), directory: [{ name: "Main Offce", room: "322", confidence: 0.4 }] };
    const r = applyAnswer(p, item("restroom-gender", "test-L1-g002", "women"), { value: "women", accessible: true }).proposal;
    expect(r.rooms[1]).toMatchObject({ restroom: { gender: "women", accessible: true }, name: "Women's restroom" });
    const al = applyAnswer(p, item("alias", "test-L1-directory", "Main Offce = 322"), { value: "Main Office = 322" }).proposal;
    expect(al.directory).toEqual([{ name: "Main Office", room: "322", confidence: 1 }]);
    const ic = applyAnswer(p, item("icon", "test-L1-i001", "dwa"), { value: null }).proposal;
    expect(ic.icons).toHaveLength(0);
  });
});

describe("accept", () => {
  it("lists blockers, then converts to a valid level in meters", () => {
    let p = tiny();
    const queue = [item("restroom-gender", "test-L1-g002")];
    const blockers = acceptBlockers(p, queue);
    expect(blockers.join("\n")).toMatch(/review item/);
    expect(blockers.join("\n")).toMatch(/neither number nor name/);
    expect(blockers.join("\n")).toMatch(/disconnected/);

    p = applyAnswer(p, queue[0]!, { value: "all", accessible: true }).proposal;
    p = addEdge(p, "test-L1-n002", "test-L1-n003");
    p = setDoor(p, "test-L1-g002", [700, 530]);
    expect(acceptBlockers(p, [{ ...queue[0]!, resolved: { value: "all", at: "now" } }])).toEqual([]);

    const level: Level = proposalToLevel(p, { sortIndex: 2, displayName: "1", elevationM: 4.5, heightM: 4.5, heightSource: "default", verified: true }, { scale: 0.05, rotation: 0, tx: -25, ty: 25 });
    // Pixel (100, 500) -> (0.05*100 - 25, 0.05*-500 + 25) = (-20, 0)
    expect(level.nodes[0]).toMatchObject({ x: -20, y: 0 });
    expect(level.pois.map((x) => x.kind).sort()).toEqual(["dwa", "gender-inclusive-restroom"]);
  });

  it("lets a room be entered through another one, and gives it that room's door", () => {
    let p = tiny();
    p = addEdge(p, "test-L1-n002", "test-L1-n003");
    p = setDoor(p, "test-L1-g002", [700, 530]);
    p = { ...p, rooms: p.rooms.map((r) => (r.id === "test-L1-g002" ? { ...r, number: "31" } : r)) };
    const host = p.rooms.find((r) => r.id === "test-L1-g002")!;
    const inner = { ...host, id: "test-L1-g090", regionId: "test-L1-g090", number: "31A", doors: [], enteredVia: host.id };
    p = { ...p, rooms: [...p.rooms, inner] };

    // No door of its own is fine, as long as its host has one; a dangling reference is not.
    expect(acceptBlockers(p, []).join("\n")).not.toMatch(/without a valid door/);
    const bad = { ...p, rooms: p.rooms.map((r) => (r.id === inner.id ? { ...r, enteredVia: "test-L1-nope" } : r)) };
    expect(acceptBlockers(bad, []).join("\n")).toMatch(/entered via a room that isn't on this level/);

    const level = proposalToLevel(p, { sortIndex: 2, displayName: "1", elevationM: 4.5, heightM: 4.5, heightSource: "default", verified: true }, { scale: 0.05, rotation: 0, tx: -25, ty: 25 });
    const room = level.rooms.find((r) => r.number === "31A")!;
    expect(room.enteredVia).toBe(host.id);
    expect(room.doors).toEqual(level.rooms.find((r) => r.id === host.id)!.doors);
    expect(room.doors.length).toBe(1);
  });

  function item(kind: ReviewItem["kind"], targetId: string): ReviewItem {
    return { id: `${targetId}-x`, kind, crop: "", candidates: [], targetId };
  }
});

describe("shafts", () => {
  const lv = (id: string, sortIndex: number, nodes: [string, "stair" | "elevator", number, number][]): Level =>
    ({ id, sortIndex, nodes: nodes.map(([nid, kind, x, y]) => ({ id: nid, levelId: id, kind, x, y, verified: false })) }) as unknown as Level;

  it("stacks nearby nodes and can skip a partial level", () => {
    const levels = [
      lv("B", 0, [["b-s1", "stair", 0, 0], ["b-v1", "elevator", 20, 0]]),
      lv("M", 1, [["m-s9", "stair", 50, 50]]),
      lv("L1", 2, [["l1-s1", "stair", 1, 1], ["l1-v1", "elevator", 21, 0.5]]),
      lv("L2", 3, [["l2-s1", "stair", 0.5, -1], ["l2-v1", "elevator", 30, 0]]),
    ];
    const shafts = proposeShafts(levels, 4);
    expect(shafts).toContainEqual(expect.objectContaining({ kind: "stair", nodeIds: ["b-s1", "l1-s1", "l2-s1"] }));
    expect(shafts).toContainEqual(expect.objectContaining({ kind: "elevator", nodeIds: ["b-v1", "l1-v1"] }));
    const { shaft, edges } = shaftToGraph("wheeler", 1, shafts[0]!);
    expect(shaft.id).toBe("wheeler-shaft-s1");
    expect(edges.map((e) => [e.a, e.b])).toEqual([["b-s1", "l1-s1"], ["l1-s1", "l2-s1"]]);
  });
});

describe("real Wheeler proposals", () => {
  for (const level of ["L1", "M"]) {
    const path = join(ROOT, "data", "work", "wheeler", level, "proposal.json");
    it.skipIf(!exists(path))(`${level}: parses, and blockers are explained`, () => {
      const p = Proposal.parse(JSON.parse(readFileSync(path, "utf8")));
      const q = ReviewQueue.parse(JSON.parse(readFileSync(path.replace("proposal.json", "review-queue.json"), "utf8")));
      const blockers = acceptBlockers(p, q.items);
      if (level === "M") expect(blockers).toEqual([]);
      else expect(blockers.length).toBeGreaterThan(0);
    });
  }
});

function exists(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

describe("suite auto-split", () => {
  it("gives each room its piece, keeps the shared outline for empty ones, and separates regions", async () => {
    const { applySuiteSplit } = await import("./split");
    const p = tiny();
    const shared = p.rooms[0]!;
    const twin = { ...shared, id: "test-L1-g500", number: "101B" };
    const before = { ...p, rooms: [...p.rooms, twin] };
    const piece: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const { proposal, missed } = applySuiteSplit(before, [shared.id, twin.id], [piece, []]);
    expect(missed).toEqual([twin.id]);
    const got = proposal.rooms.find((r) => r.id === shared.id)!;
    expect(got.polygon).toEqual(piece);
    expect(got.regionId).toBe(shared.id);
    expect(proposal.rooms.find((r) => r.id === twin.id)!.polygon).toEqual(shared.polygon);
  });
});

describe("suite split assignment", () => {
  it("gives each room the piece containing its printed number", async () => {
    const { assignSplit } = await import("./split");
    const outline: [number, number][] = [[0, 0], [100, 0], [100, 300], [0, 300]];
    const base = tiny();
    const room = (n: string, labelAt: [number, number] | undefined) => ({ ...base.rooms[0]!, id: `test-L1-r${n}`, number: n, regionId: "test-L1-g009", polygon: outline, labelAt });
    const p = { ...base, rooms: [room("111", [50, 250]), room("113", [50, 150]), room("115", [50, 50])] };
    const pieces = splitPolygon(outline, [-10, 200], [110, 200])!;
    const rooms = assignSplit(p, p.rooms[2]!, pieces);
    const byNum = new Map(rooms.map((r) => [r.number, r]));
    expect(Math.max(...byNum.get("111")!.polygon.map((q) => q[1]))).toBe(300);
    expect(Math.max(...byNum.get("113")!.polygon.map((q) => q[1]))).toBe(200);
    expect(Math.max(...byNum.get("115")!.polygon.map((q) => q[1]))).toBe(200);
    expect(rooms).toHaveLength(3);

    const lone = { ...base, rooms: [room("120", undefined)] };
    const split = assignSplit(lone, lone.rooms[0]!, pieces);
    expect(split).toHaveLength(2);
    expect(split[1]!.number).toBeNull();
  });
});

describe("alignment", () => {
  it("recovers a rotated, scaled, shifted L-shaped outline", async () => {
    const { autoAlign, fromAnchors, residuals, svgMatrix } = await import("./align");
    const { apply } = await import("@wf/geometry");
    const dst: [number, number][] = [[0, 0], [400, 0], [400, 150], [150, 150], [150, 300], [0, 300]];
    const truth = { scale: 0.5, rotation: -Math.PI / 2, tx: 900, ty: 100 };
    // src is dst mapped by the inverse of truth, so truth maps src -> dst.
    const inv = { scale: 2, rotation: Math.PI / 2, tx: 0, ty: 0 };
    const src = dst.map((p) => {
      const q = apply(inv, [p[0] - 900, p[1] - 100]);
      return q;
    });
    const r = autoAlign(src, dst);
    expect(r.error).toBeLessThan(2);
    const check = apply(r.transform, src[1]!);
    expect(check[0]).toBeCloseTo(dst[1]![0], 0);
    expect(check[1]).toBeCloseTo(dst[1]![1], 0);
    expect(truth.scale).toBeCloseTo(r.transform.scale, 2);

    const anchors = [0, 2, 4].map((i) => ({ src: src[i]!, dst: dst[i]! }));
    const fit = fromAnchors(anchors)!;
    expect(fit.rms).toBeLessThan(1e-6);
    expect(Math.max(...residuals(anchors, fit.transform))).toBeLessThan(1e-6);
    expect(svgMatrix({ scale: 1, rotation: 0, tx: 5, ty: 6 })).toBe("matrix(1 0 0 1 5 6)");
  });
});
