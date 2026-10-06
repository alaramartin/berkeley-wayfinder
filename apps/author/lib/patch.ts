/**
 * Importing a field patch: what it would change, and the changed data.
 *
 * Pure, so the review screen and the tests share it. The same accepted edits go to three places: the
 * canonical level files (what the app reads), the proposals (so the next re-accept of a level keeps the
 * field's corrections instead of resetting them), and the building's shafts and entrances. Step counts
 * also re-derive floor heights.
 */
import { type FieldData, type OpResult, applyOps, deriveElevations, hashFieldData } from "@wf/field";
import type { Building, Level, Patch, Proposal } from "@wf/schema";

export interface PatchInput {
  building: Building;
  levels: Level[];
  /** Level id -> its proposal, for the levels that have one. */
  proposals: Map<string, Proposal>;
}

export interface ElevationChange {
  levelId: string;
  before: { elevationM: number; heightM: number; heightSource: string };
  after: { elevationM: number; heightM: number; heightSource: string };
}

export interface PatchOutcome {
  building: Building;
  levels: Level[];
  proposals: Map<string, Proposal>;
  /** One per op in the patch, in order; ops that were not accepted are `skipped` with a reason. */
  results: OpResult[];
  buildingChanged: boolean;
  changedLevels: string[];
  changedProposals: string[];
  elevations: ElevationChange[];
  elevationNotes: string[];
  notes: { levelId: string; at?: [number, number]; text: string }[];
  /** False when the data has changed since the patch was made (the walk was against older data). */
  baseMatches: boolean;
  currentHash: string;
}

const clone = <T>(value: T): T => structuredClone(value);

function fieldData(building: Building, levels: Level[]): FieldData {
  return { rooms: levels.flatMap((l) => l.rooms), edges: levels.flatMap((l) => l.edges), entrances: building.entrances, shafts: building.shafts };
}

/** Run `patch` against a copy of the data. `accepted` picks which ops (by index) to apply; default all. */
export function runPatch(input: PatchInput, patch: Patch, accepted?: ReadonlySet<number>): PatchOutcome {
  const currentHash = hashFieldData(fieldData(input.building, input.levels));
  const building = clone(input.building);
  const levels = clone(input.levels);
  const proposals = clone(input.proposals);

  const chosen = patch.ops.map((op, index) => ({ op, index })).filter((c) => !accepted || accepted.has(c.index));
  const applied = applyOps(fieldData(building, levels), chosen.map((c) => c.op));
  const results: OpResult[] = patch.ops.map((op, index) => ({ index, op, status: "skipped", summary: "Not applied", before: "", after: "", reason: "left out of this import" }));
  applied.forEach((r, k) => (results[chosen[k]!.index] = { ...r, index: chosen[k]!.index }));

  // The same edits, in the proposals, so a later accept does not undo them.
  const changedProposals: string[] = [];
  for (const [levelId, proposal] of proposals) {
    const before = JSON.stringify(proposal);
    applyOps({ rooms: proposal.rooms, edges: proposal.edges, entrances: proposal.entrances, shafts: [] }, chosen.map((c) => c.op));
    if (JSON.stringify(proposal) !== before) changedProposals.push(levelId);
  }

  const changedLevels = levels.filter((l, i) => JSON.stringify(l) !== JSON.stringify(input.levels[i])).map((l) => l.id);
  const buildingChanged = JSON.stringify(building) !== JSON.stringify(input.building);

  // Step counts fix floor heights: re-stack the levels from them.
  const elevations: ElevationChange[] = [];
  let elevationNotes: string[] = [];
  if (applied.some((r, k) => r.status === "applied" && chosen[k]!.op.op === "setStepCount")) {
    const nodeLevel = new Map(levels.flatMap((l) => l.nodes.map((n) => [n.id, l.id] as const)));
    const derived = deriveElevations(
      levels.map((l) => ({ id: l.id, sortIndex: l.sortIndex, elevationM: l.elevationM, heightM: l.heightM, heightSource: l.heightSource })),
      building.shafts,
      (id) => nodeLevel.get(id),
    );
    elevationNotes = derived.notes;
    for (const d of derived.levels) {
      const level = levels.find((l) => l.id === d.id)!;
      if (level.elevationM === d.elevationM && level.heightM === d.heightM && level.heightSource === d.heightSource) continue;
      elevations.push({
        levelId: d.id,
        before: { elevationM: level.elevationM, heightM: level.heightM, heightSource: level.heightSource },
        after: { elevationM: d.elevationM, heightM: d.heightM, heightSource: d.heightSource },
      });
      level.elevationM = d.elevationM;
      level.heightM = d.heightM;
      level.heightSource = d.heightSource;
      if (!changedLevels.includes(d.id)) changedLevels.push(d.id);
    }
  }

  const notes = chosen.flatMap((c, k) => (c.op.op === "note" && applied[k]!.status === "applied" ? [{ levelId: c.op.levelId, ...(c.op.at ? { at: c.op.at } : {}), text: c.op.text }] : []));

  return {
    building,
    levels,
    proposals,
    results,
    buildingChanged,
    changedLevels,
    changedProposals,
    elevations,
    elevationNotes,
    notes,
    baseMatches: patch.baseHash === currentHash,
    currentHash,
  };
}
