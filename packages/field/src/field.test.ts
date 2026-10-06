import { readFile } from "node:fs/promises";
import path from "node:path";
import { Building, Level, type PatchOp } from "@wf/schema";
import { describe, expect, it } from "vitest";
import { type FieldData, applyOps, deriveElevations, hashFieldData, makePatch, readPatch, STEP_RISE_M } from "./index";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "data", "buildings", "wheeler");

async function wheeler() {
  const building = Building.parse(JSON.parse(await readFile(path.join(ROOT, "building.json"), "utf8")));
  const levels = await Promise.all(building.levels.map(async (l) => Level.parse(JSON.parse(await readFile(path.join(ROOT, "levels", `${l.id}.json`), "utf8")))));
  const data: FieldData = {
    rooms: levels.flatMap((l) => l.rooms),
    edges: levels.flatMap((l) => l.edges),
    entrances: building.entrances,
    shafts: building.shafts,
  };
  return { building, levels, data };
}

const clone = <T>(v: T): T => structuredClone(v);

describe("applying field edits", () => {
  it("confirms a door, and the same patch applied twice changes nothing more", async () => {
    const { data } = await wheeler();
    const room = data.rooms.find((r) => r.doors.length && !r.doors[0]!.verified)!;
    const op: PatchOp = { op: "confirmDoor", roomId: room.id, doorIndex: 0 };
    const copy = clone(data);
    const [first] = applyOps(copy, [op]);
    expect(first!.status).toBe("applied");
    expect(first!.before).toContain("unconfirmed");
    expect(first!.after).toContain("confirmed");
    expect(copy.rooms.find((r) => r.id === room.id)!.doors[0]!.verified).toBe(true);
    const again = applyOps(copy, [op])[0]!;
    expect(again.before).toBe(again.after.replace("confirmed", "confirmed"));
    expect(hashFieldData(copy)).not.toBe(hashFieldData(data));
  });

  it("moves a door onto another corridor and adds a second door", async () => {
    const { data } = await wheeler();
    const copy = clone(data);
    const room = copy.rooms.find((r) => r.doors.length)!;
    const target = copy.edges.find((e) => e.id !== room.doors[0]!.edgeId)!;
    const [moved, added] = applyOps(copy, [
      { op: "moveDoor", roomId: room.id, doorIndex: 0, edgeId: target.id, t: 0.25, side: "right" },
      { op: "addDoor", roomId: room.id, edgeId: target.id, t: 0.75, side: "left" },
    ]);
    expect([moved!.status, added!.status]).toEqual(["applied", "applied"]);
    expect(room.doors[0]).toMatchObject({ edgeId: target.id, t: 0.25, side: "right", verified: true });
    expect(room.doors.at(-1)).toMatchObject({ t: 0.75, verified: true });
  });

  it("renumbers a room and sets corridor access and entrance accessibility", async () => {
    const { data } = await wheeler();
    const copy = clone(data);
    const room = copy.rooms.find((r) => r.number)!;
    const edge = copy.edges[0]!;
    const entrance = copy.entrances[0]!;
    const results = applyOps(copy, [
      { op: "setRoomNumber", roomId: room.id, number: "999" },
      { op: "setEdgeAccess", edgeId: edge.id, access: "card" },
      { op: "confirmEntrance", entranceId: entrance.id, accessible: !entrance.accessible },
    ]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);
    expect(room.number).toBe("999");
    expect(edge).toMatchObject({ access: "card", verified: true });
    expect(entrance.verified).toBe(true);
  });

  it("skips an op that names something missing instead of failing the whole patch", async () => {
    const { data } = await wheeler();
    const copy = clone(data);
    const results = applyOps(copy, [
      { op: "confirmDoor", roomId: "wheeler-L9-r404", doorIndex: 0 },
      { op: "setStepCount", shaftId: "wheeler-shaft-s1", index: 5, steps: 20 },
      { op: "setEdgeAccess", edgeId: "nope", access: "locked" },
    ]);
    expect(results.every((r) => r.status === "skipped" && r.reason)).toBe(true);
    expect(hashFieldData(copy)).toBe(hashFieldData(data));
  });
});

describe("the base hash", () => {
  it("ignores things a patch cannot change, and notices things it can", async () => {
    const { data } = await wheeler();
    expect(hashFieldData(data)).toBe(hashFieldData(clone(data)));
    const moved = clone(data);
    (moved.rooms[0] as unknown as { polygon?: number[][] }).polygon = [[0, 0]];
    expect(hashFieldData(moved)).toBe(hashFieldData(data));
    const renumbered = clone(data);
    renumbered.rooms[0]!.number = "ZZZ";
    expect(hashFieldData(renumbered)).not.toBe(hashFieldData(data));
  });

  it("patches round-trip through text and reject nonsense with a readable message", async () => {
    const { data } = await wheeler();
    const patch = makePatch("wheeler", data, [{ op: "note", levelId: "L1", text: "door sticks" }], "me", new Date("2026-10-06T12:00:00Z"));
    const back = readPatch(JSON.stringify(patch));
    expect(back.ok && back.patch.baseHash).toBe(patch.baseHash);
    const bad = readPatch(JSON.stringify({ ...patch, ops: [{ op: "teleport" }] }));
    expect(bad.ok).toBe(false);
    expect(readPatch("not json")).toEqual({ ok: false, error: "That file is not JSON." });
  });
});

describe("floor heights from step counts", () => {
  it("a sample patch of step counts updates Wheeler's elevations", async () => {
    const { building, levels, data } = await wheeler();
    const copy = clone(data);
    // Counted the same flight on two stairwells, one of them off by two steps.
    const results = applyOps(copy, [
      { op: "setStepCount", shaftId: "wheeler-shaft-s6", index: 0, steps: 26 }, // L1 -> L2
      { op: "setStepCount", shaftId: "wheeler-shaft-s7", index: 0, steps: 28 }, // L1 -> L2
      { op: "setStepCount", shaftId: "wheeler-shaft-s6", index: 1, steps: 27 }, // L2 -> L3
    ]);
    expect(results.every((r) => r.status === "applied")).toBe(true);

    const nodeLevel = new Map(levels.flatMap((l) => l.nodes.map((n) => [n.id, l.id] as const)));
    const out = deriveElevations(
      levels.map((l) => ({ id: l.id, sortIndex: l.sortIndex, elevationM: l.elevationM, heightM: l.heightM, heightSource: l.heightSource })),
      copy.shafts,
      (id) => nodeLevel.get(id),
    );
    const byId = new Map(out.levels.map((l) => [l.id, l]));
    // Median of 26 and 28 steps is 27.
    expect(byId.get("L1")!.heightM).toBeCloseTo(27 * STEP_RISE_M, 2);
    expect(byId.get("L1")!.heightSource).toBe("stair-count");
    expect(byId.get("L2")!.heightM).toBeCloseTo(27 * STEP_RISE_M, 2);
    // The stack is re-stacked: each floor sits one height above the one below.
    expect(byId.get("L2")!.elevationM).toBeCloseTo(byId.get("L1")!.elevationM + byId.get("L1")!.heightM, 2);
    expect(byId.get("L3")!.elevationM).toBeCloseTo(byId.get("L2")!.elevationM + byId.get("L2")!.heightM, 2);
    // Levels nobody counted keep their guess.
    expect(byId.get("L3")!.heightSource).toBe(levels.find((l) => l.id === "L3")!.heightSource);
    expect(building.levels.length).toBe(out.levels.length);
  });

  it("reports a flight that skips a level instead of guessing", async () => {
    const { levels, data } = await wheeler();
    const copy = clone(data);
    applyOps(copy, [{ op: "setStepCount", shaftId: "wheeler-shaft-s1", index: 0, steps: 40 }]); // B -> L1, past M
    const nodeLevel = new Map(levels.flatMap((l) => l.nodes.map((n) => [n.id, l.id] as const)));
    const out = deriveElevations(
      levels.map((l) => ({ id: l.id, sortIndex: l.sortIndex, elevationM: l.elevationM, heightM: l.heightM, heightSource: l.heightSource })),
      copy.shafts,
      (id) => nodeLevel.get(id),
    );
    expect(out.notes.join(" ")).toMatch(/skips 1 level/);
    expect(out.levels.find((l) => l.id === "B")!.heightSource).toBe(levels.find((l) => l.id === "B")!.heightSource);
  });

  it("ignores step counts on a lift", () => {
    const out = deriveElevations(
      [
        { id: "A", sortIndex: 0, elevationM: 0, heightM: 4.5, heightSource: "default" },
        { id: "B", sortIndex: 1, elevationM: 4.5, heightM: 4.5, heightSource: "default" },
      ],
      [{ id: "lift", kind: "elevator", nodeIds: ["a", "b"], stepCounts: [10] }],
      (id) => id.toUpperCase(),
    );
    expect(out.levels[0]!.heightM).toBe(4.5);
  });
});
