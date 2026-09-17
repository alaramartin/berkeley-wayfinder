import { describe, expect, it } from "vitest";
import { Level, Patch, Poi, Proposal } from "./index";

const level = {
  id: "L1",
  buildingId: "wheeler",
  sortIndex: 2,
  displayName: "1",
  elevationM: 9,
  heightM: 4.5,
  heightSource: "default",
  outline: [[0, 0], [60, 0], [60, 45], [0, 45]],
  imageTransform: { scale: 0.02, rotation: 0, tx: -30, ty: -22 },
  nodes: [
    { id: "wheeler-L1-n001", levelId: "L1", x: 1, y: 2, kind: "junction" },
    { id: "wheeler-L1-n002", levelId: "L1", x: 20, y: 2, kind: "junction" },
  ],
  edges: [{ id: "wheeler-L1-e001", a: "wheeler-L1-n001", b: "wheeler-L1-n002", kind: "corridor", accessible: true }],
  rooms: [
    {
      id: "wheeler-L1-r120",
      number: "120",
      category: "classroom",
      levelId: "L1",
      polygon: [[0, 0], [5, 0], [5, 5]],
      doors: [{ edgeId: "wheeler-L1-e001", t: 0.25, side: "left" }],
    },
  ],
};

describe("schema", () => {
  it("parses a level and fills defaults", () => {
    const parsed = Level.parse(level);
    expect(parsed.nodes[0]?.verified).toBe(false);
    expect(parsed.edges[0]?.access).toBe("open");
    expect(parsed.rooms[0]?.doors[0]?.verified).toBe(false);
    expect(parsed.voids).toEqual([]);
  });

  it("round-trips through JSON", () => {
    const parsed = Level.parse(level);
    expect(Level.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("rejects door t outside 0..1 and bad ids", () => {
    const bad = structuredClone(level);
    bad.rooms[0]!.doors[0]!.t = 1.5;
    expect(Level.safeParse(bad).success).toBe(false);
    expect(Level.safeParse({ ...level, buildingId: "Wheeler Hall" }).success).toBe(false);
  });

  it("requires a poi anchor", () => {
    expect(Poi.safeParse({ id: "p1", kind: "restroom", levelId: "L1" }).success).toBe(false);
  });

  it("parses patches by op", () => {
    const p = Patch.parse({
      buildingId: "wheeler",
      baseHash: "abc",
      createdAt: "2026-09-16T00:00:00Z",
      ops: [{ op: "setStepCount", shaftId: "wheeler-shaft-s1", index: 0, steps: 26 }],
    });
    expect(p.ops[0]?.op).toBe("setStepCount");
    expect(Patch.safeParse({ ...p, ops: [{ op: "teleport" }] }).success).toBe(false);
  });

  it("parses an empty proposal", () => {
    expect(
      Proposal.safeParse({
        buildingId: "wheeler",
        levelId: "L1",
        imageSize: [3000, 2000],
        generatedAt: "now",
        pipelineVersion: "0.0.0",
        outline: null,
        nodes: [],
        edges: [],
        rooms: [],
        icons: [],
      }).success,
    ).toBe(true);
  });
});

describe("authoring schema", () => {
  it("allows unnumbered rooms only with a name", async () => {
    const { Room } = await import("./index");
    const base = { id: "wheeler-L1-g010", category: "restroom", levelId: "L1", polygon: [[0, 0], [1, 0], [1, 1]] };
    expect(Room.safeParse({ ...base, number: null }).success).toBe(false);
    expect(Room.safeParse({ ...base, number: null, name: "Women's restroom" }).success).toBe(true);
  });

  it("parses an alignment file", async () => {
    const { Alignment } = await import("./index");
    const a = Alignment.parse({
      buildingId: "wheeler",
      referenceLevel: "L1",
      levels: { L1: { transform: { scale: 1, rotation: 0, tx: 0, ty: 0 }, rms: 0 }, L2: { rotationHint: 90, transform: null, rms: null } },
      osm: { wayId: null, origin: null, transform: null, rms: null },
    });
    expect(a.levels.L2?.rotationHint).toBe(90);
    expect(a.levels.L1?.anchors).toEqual([]);
  });
});
