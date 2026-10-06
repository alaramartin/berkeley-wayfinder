import { readFile } from "node:fs/promises";
import path from "node:path";
import { Building, Level, Proposal, type Patch } from "@wf/schema";
import { makePatch } from "@wf/field";
import { describe, expect, it } from "vitest";
import { proposalToLevel } from "./accept";
import { type PatchInput, runPatch } from "./patch";

const DATA = path.resolve(import.meta.dirname, "..", "..", "..", "data");

async function wheeler(): Promise<PatchInput> {
  const building = Building.parse(JSON.parse(await readFile(path.join(DATA, "buildings", "wheeler", "building.json"), "utf8")));
  const levels = await Promise.all(building.levels.map(async (l) => Level.parse(JSON.parse(await readFile(path.join(DATA, "buildings", "wheeler", "levels", `${l.id}.json`), "utf8")))));
  const proposals = new Map<string, Proposal>();
  for (const l of building.levels) {
    proposals.set(l.id, Proposal.parse(JSON.parse(await readFile(path.join(DATA, "work", "wheeler", l.id, "proposal.json"), "utf8"))));
  }
  return { building, levels, proposals };
}

const patchFor = (input: PatchInput, ops: Patch["ops"]): Patch =>
  makePatch(
    "wheeler",
    { rooms: input.levels.flatMap((l) => l.rooms), edges: input.levels.flatMap((l) => l.edges), entrances: input.building.entrances, shafts: input.building.shafts },
    ops,
    "tester",
    new Date("2026-10-07T12:00:00Z"),
  );

describe("importing a field patch", () => {
  it("flips door flags in the accepted data AND the proposal, and a re-accept keeps them", async () => {
    const input = await wheeler();
    const level = input.levels.find((l) => l.id === "L2")!;
    const room = level.rooms.find((r) => r.doors.length && !r.enteredVia && !r.doors[0]!.verified)!;
    const out = runPatch(input, patchFor(input, [{ op: "confirmDoor", roomId: room.id, doorIndex: 0 }]));

    expect(out.results[0]!.status).toBe("applied");
    expect(out.levels.find((l) => l.id === "L2")!.rooms.find((r) => r.id === room.id)!.doors[0]!.verified).toBe(true);
    expect(out.changedLevels).toEqual(["L2"]);
    expect(out.changedProposals).toEqual(["L2"]);
    // The input is never mutated: preview must not change anything.
    expect(level.rooms.find((r) => r.id === room.id)!.doors[0]!.verified).toBe(false);

    // The point of patching the proposal too: accepting the level again keeps the confirmation.
    const again = proposalToLevel(out.proposals.get("L2")!, { sortIndex: level.sortIndex, displayName: level.displayName, elevationM: level.elevationM, heightM: level.heightM, heightSource: level.heightSource, verified: level.verified }, level.imageTransform);
    expect(again.rooms.find((r) => r.id === room.id)!.doors[0]!.verified).toBe(true);
    // And other doors are still unconfirmed.
    expect(again.rooms.filter((r) => r.doors.some((d) => d.verified)).length).toBe(1);
  });

  it("a moved door and a corridor's access survive a re-accept too", async () => {
    const input = await wheeler();
    const level = input.levels.find((l) => l.id === "L1")!;
    const room = level.rooms.find((r) => r.doors.length && !r.enteredVia)!;
    const other = level.edges.find((e) => e.kind === "corridor" && e.id !== room.doors[0]!.edgeId)!;
    const out = runPatch(input, patchFor(input, [
      { op: "moveDoor", roomId: room.id, doorIndex: 0, edgeId: other.id, t: 0.3, side: "right" },
      { op: "setEdgeAccess", edgeId: other.id, access: "card" },
    ]));
    const again = proposalToLevel(out.proposals.get("L1")!, { sortIndex: level.sortIndex, displayName: level.displayName, elevationM: level.elevationM, heightM: level.heightM, heightSource: level.heightSource, verified: level.verified }, level.imageTransform);
    expect(again.rooms.find((r) => r.id === room.id)!.doors[0]).toMatchObject({ edgeId: other.id, t: 0.3, side: "right", verified: true });
    expect(again.edges.find((e) => e.id === other.id)).toMatchObject({ access: "card", verified: true });
  });

  it("step counts re-stack the floors and say what changed", async () => {
    const input = await wheeler();
    const out = runPatch(input, patchFor(input, [
      { op: "setStepCount", shaftId: "wheeler-shaft-s6", index: 0, steps: 25 },
      { op: "setStepCount", shaftId: "wheeler-shaft-s6", index: 1, steps: 25 },
    ]));
    expect(out.buildingChanged).toBe(true);
    const l1 = out.elevations.find((e) => e.levelId === "L1")!;
    expect(l1.after.heightSource).toBe("stair-count");
    expect(l1.after.heightM).toBeCloseTo(25 * 0.17, 2);
    expect(out.levels.find((l) => l.id === "L1")!.heightM).toBeCloseTo(25 * 0.17, 2);
    // Everything above L1 moved down with it.
    const l3before = input.levels.find((l) => l.id === "L3")!.elevationM;
    expect(out.levels.find((l) => l.id === "L3")!.elevationM).toBeLessThan(l3before);
    expect(out.changedLevels).toEqual(expect.arrayContaining(["L1", "L2", "L3"]));
  });

  it("only applies the ops that were accepted", async () => {
    const input = await wheeler();
    const rooms = input.levels.flatMap((l) => l.rooms).filter((r) => r.doors.length && !r.enteredVia && !r.doors[0]!.verified);
    const ops = [
      { op: "confirmDoor", roomId: rooms[0]!.id, doorIndex: 0 },
      { op: "confirmDoor", roomId: rooms[1]!.id, doorIndex: 0 },
    ] as const;
    const out = runPatch(input, patchFor(input, [...ops]), new Set([1]));
    expect(out.results.map((r) => r.status)).toEqual(["skipped", "applied"]);
    expect(out.results[0]!.reason).toMatch(/left out/);
    const all = out.levels.flatMap((l) => l.rooms);
    expect(all.find((r) => r.id === rooms[0]!.id)!.doors[0]!.verified).toBe(false);
    expect(all.find((r) => r.id === rooms[1]!.id)!.doors[0]!.verified).toBe(true);
  });

  it("warns when the data changed since the walk, and files notes", async () => {
    const input = await wheeler();
    const patch = patchFor(input, [{ op: "note", levelId: "L1", at: [1, 2], text: "door sticks" }]);
    expect(runPatch(input, patch).baseMatches).toBe(true);
    const changed = structuredClone(input);
    changed.levels[0]!.rooms.find((r) => r.number)!.number = "ZZZ";
    const out = runPatch(changed, patch);
    expect(out.baseMatches).toBe(false);
    expect(out.notes).toEqual([{ levelId: "L1", at: [1, 2], text: "door sticks" }]);
    expect(out.changedLevels).toEqual([]);
  });

  it("does not touch the shared 222/224 suite doors twice when ops name a missing thing", async () => {
    const input = await wheeler();
    const out = runPatch(input, patchFor(input, [{ op: "confirmDoor", roomId: "wheeler-L9-r1", doorIndex: 0 }]));
    expect(out.results[0]!.status).toBe("skipped");
    expect(out.changedLevels).toEqual([]);
    expect(out.buildingChanged).toBe(false);
  });
});
