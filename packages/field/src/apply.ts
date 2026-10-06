/**
 * Applying field edits (a `Patch`) to data, and saying what each one did.
 *
 * The same ops are applied to three shapes that all carry rooms, edges and entrances: the canonical
 * level files, the author tool's proposals (so a later re-accept keeps the field's corrections), and
 * the phone's own copy while it is still being edited. So this works on small structural types rather
 * than on `Level` or `Proposal`, and mutates what it is given: callers pass clones.
 */
import type { Access, PatchOp } from "@wf/schema";

export interface DoorLike {
  edgeId: string;
  t: number;
  side: "left" | "right";
  verified?: boolean;
}
export interface RoomLike {
  id: string;
  number: string | null;
  doors: DoorLike[];
}
export interface EdgeLike {
  id: string;
  access?: Access;
  verified?: boolean;
}
export interface EntranceLike {
  id: string;
  accessible: boolean;
  verified?: boolean;
}
export interface ShaftLike {
  id: string;
  kind?: string;
  nodeIds: string[];
  stepCounts?: (number | null)[];
}

export interface FieldData {
  rooms: RoomLike[];
  edges: EdgeLike[];
  entrances: EntranceLike[];
  shafts: ShaftLike[];
}

export interface OpResult {
  index: number;
  op: PatchOp;
  /** `skipped` means the thing the op names is not in this data; nothing changed. */
  status: "applied" | "skipped";
  /** One line a person can read in a review list. */
  summary: string;
  before: string;
  after: string;
  reason?: string;
}

const doorText = (d: DoorLike | undefined): string => (d ? `edge ${d.edgeId} at ${Math.round(d.t * 100)}%, ${d.side}${d.verified ? ", confirmed" : ", unconfirmed"}` : "none");

/** Apply `ops` in order. Ops that name something missing are skipped with a reason, not thrown. */
export function applyOps(data: FieldData, ops: PatchOp[]): OpResult[] {
  const room = (id: string) => data.rooms.find((r) => r.id === id);
  const edge = (id: string) => data.edges.find((e) => e.id === id);
  const label = (r: RoomLike) => `Room ${r.number ?? r.id}`;

  return ops.map((op, index): OpResult => {
    const skip = (reason: string, summary: string): OpResult => ({ index, op, status: "skipped", summary, before: "", after: "", reason });
    switch (op.op) {
      case "confirmDoor": {
        const r = room(op.roomId);
        const d = r?.doors[op.doorIndex];
        if (!r || !d) return skip(`no door ${op.doorIndex} on ${op.roomId}`, `Confirm a door on ${op.roomId}`);
        const before = doorText(d);
        d.verified = true;
        return { index, op, status: "applied", summary: `${label(r)}: door confirmed`, before, after: doorText(d) };
      }
      case "moveDoor": {
        const r = room(op.roomId);
        const d = r?.doors[op.doorIndex];
        if (!r || !d) return skip(`no door ${op.doorIndex} on ${op.roomId}`, `Move a door on ${op.roomId}`);
        if (!edge(op.edgeId)) return skip(`no corridor ${op.edgeId}`, `${label(r)}: move door`);
        const before = doorText(d);
        Object.assign(d, { edgeId: op.edgeId, t: op.t, side: op.side, verified: true });
        return { index, op, status: "applied", summary: `${label(r)}: door moved`, before, after: doorText(d) };
      }
      case "addDoor": {
        const r = room(op.roomId);
        if (!r) return skip(`no room ${op.roomId}`, `Add a door to ${op.roomId}`);
        if (!edge(op.edgeId)) return skip(`no corridor ${op.edgeId}`, `${label(r)}: add door`);
        const door: DoorLike = { edgeId: op.edgeId, t: op.t, side: op.side, verified: true };
        r.doors.push(door);
        return { index, op, status: "applied", summary: `${label(r)}: door added`, before: "none", after: doorText(door) };
      }
      case "setRoomNumber": {
        const r = room(op.roomId);
        if (!r) return skip(`no room ${op.roomId}`, `Renumber ${op.roomId}`);
        const before = r.number ?? "(no number)";
        r.number = op.number;
        return { index, op, status: "applied", summary: `${before} is really ${op.number}`, before, after: op.number };
      }
      case "setEdgeAccess": {
        const e = edge(op.edgeId);
        if (!e) return skip(`no corridor ${op.edgeId}`, `Set access on ${op.edgeId}`);
        const before = e.access ?? "open";
        e.access = op.access;
        e.verified = true;
        return { index, op, status: "applied", summary: `Corridor ${op.edgeId}: ${op.access}`, before, after: op.access };
      }
      case "setStepCount": {
        const s = data.shafts.find((x) => x.id === op.shaftId);
        if (!s) return skip(`no stair or lift ${op.shaftId}`, `Step count on ${op.shaftId}`);
        if (op.index >= s.nodeIds.length - 1) return skip(`${op.shaftId} has only ${s.nodeIds.length - 1} flight(s)`, `Step count on ${op.shaftId}`);
        const counts = Array.from({ length: s.nodeIds.length - 1 }, (_, i) => s.stepCounts?.[i] ?? null);
        const before = counts[op.index] === null ? "not counted" : `${counts[op.index]} steps`;
        counts[op.index] = op.steps;
        s.stepCounts = counts;
        return { index, op, status: "applied", summary: `${s.id}: flight ${op.index + 1} has ${op.steps} steps`, before, after: `${op.steps} steps` };
      }
      case "confirmEntrance": {
        const en = data.entrances.find((x) => x.id === op.entranceId);
        if (!en) return skip(`no entrance ${op.entranceId}`, `Confirm entrance ${op.entranceId}`);
        const before = `${en.accessible ? "step-free" : "has steps"}, ${en.verified ? "confirmed" : "unconfirmed"}`;
        en.accessible = op.accessible;
        en.verified = true;
        return { index, op, status: "applied", summary: `Entrance ${op.entranceId}: ${op.accessible ? "step-free" : "has steps"}`, before, after: `${op.accessible ? "step-free" : "has steps"}, confirmed` };
      }
      case "note":
        // Notes change no data; the importer files them.
        return { index, op, status: "applied", summary: `Note on level ${op.levelId}: ${op.text}`, before: "", after: op.text };
    }
  });
}
