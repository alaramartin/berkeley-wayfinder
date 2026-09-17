import type { Point, Proposal, ProposalRoom } from "@wf/schema";
import { nextId } from "./ids";
import { contains } from "./polygon";

function sameShape(a: Point[], b: Point[]): boolean {
  return a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i]![0]) < 0.5 && Math.abs(p[1] - b[i]![1]) < 0.5);
}

function round(poly: Point[]): Point[] {
  return poly.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

/**
 * After splitting `selected`'s outline into two pieces, decide which room gets which piece.
 * Rooms sharing the outline (a merged suite) go to the piece containing their printed number (labelAt).
 * Unlabeled: the selected room takes a free piece. A piece nobody claims becomes a new unnumbered room.
 */
export function assignSplit(p: Proposal, selected: ProposalRoom, pieces: [Point[], Point[]]): ProposalRoom[] {
  const sharing = p.rooms.filter((r) => r === selected || (selected.regionId && r.regionId === selected.regionId && sameShape(r.polygon, selected.polygon)));
  const assigned = new Map<ProposalRoom, 0 | 1>();
  for (const r of sharing) {
    if (!r.labelAt) continue;
    if (contains(pieces[0], r.labelAt)) assigned.set(r, 0);
    else if (contains(pieces[1], r.labelAt)) assigned.set(r, 1);
  }
  if (!assigned.has(selected)) {
    const used = new Set(assigned.values());
    assigned.set(selected, used.has(0) && !used.has(1) ? 1 : 0);
  }
  const claimed = new Set(assigned.values());
  let rooms = p.rooms.map((r) => (assigned.has(r) ? { ...r, polygon: round(pieces[assigned.get(r)!]) } : r));
  for (const piece of [0, 1] as const) {
    if (claimed.has(piece)) continue;
    const id = nextId({ ...p, rooms }, "g");
    rooms = [...rooms, { ...selected, id, regionId: id, number: null, numberConfidence: 0, name: undefined, labelAt: undefined, doors: [], aliases: [], restroom: undefined, polygon: round(pieces[piece]) }];
  }
  return rooms;
}
