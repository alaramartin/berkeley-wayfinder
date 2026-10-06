/**
 * The field tool's data, as pure functions so they can be tested without a browser.
 *
 * The phone keeps only a list of edits. What it shows is the bundled data with those edits applied to
 * a copy, so undoing an edit is just removing it from the list and nothing else has to be kept in step.
 */
import { type FieldData, type OpResult, applyOps, doorMarker, inPolygon, projectOnPolyline } from "@wf/field";
import type { Building, Level, PatchOp, Point } from "@wf/schema";

export interface FieldView {
  building: Building;
  levels: Level[];
  data: FieldData;
  results: OpResult[];
}

/** A copy of the building with every recorded edit applied. */
export function buildView(base: { building: Building; levels: Level[] }, ops: PatchOp[]): FieldView {
  const building = structuredClone(base.building);
  const levels = structuredClone(base.levels);
  const data: FieldData = {
    rooms: levels.flatMap((l) => l.rooms),
    edges: levels.flatMap((l) => l.edges),
    entrances: building.entrances,
    shafts: building.shafts,
  };
  const results = applyOps(data, ops);
  return { building, levels, data, results };
}

/** The untouched data in the shape a patch's base hash is computed over. */
export function baseFieldData(base: { building: Building; levels: Level[] }): FieldData {
  return {
    rooms: base.levels.flatMap((l) => l.rooms),
    edges: base.levels.flatMap((l) => l.edges),
    entrances: base.building.entrances,
    shafts: base.building.shafts,
  };
}

export type Selection =
  | { kind: "door"; roomId: string; doorIndex: number }
  | { kind: "room"; roomId: string }
  | { kind: "entrance"; entranceId: string }
  | { kind: "shaft"; shaftId: string; nodeId: string }
  | { kind: "edge"; edgeId: string };

const roomLabel = (r: { number: string | null; name?: string; id: string }) => r.number ?? r.name ?? r.id;

export interface ToCheck {
  doors: { roomId: string; doorIndex: number; levelId: string; label: string }[];
  entrances: { entranceId: string; label: string }[];
  stairs: { shaftId: string; label: string; counted: number; flights: number }[];
  /** Doors confirmed out of all doors, for a progress line. */
  confirmed: number;
  total: number;
}

/** What is still unconfirmed, in the order a person would walk it. */
export function toCheck(view: FieldView): ToCheck {
  const doors: ToCheck["doors"] = [];
  let confirmed = 0;
  let total = 0;
  for (const level of view.levels) {
    for (const room of level.rooms) {
      // Rooms entered through another share its door; confirming it twice would be busywork.
      if (room.enteredVia) continue;
      room.doors.forEach((door, doorIndex) => {
        total++;
        if (door.verified) confirmed++;
        else doors.push({ roomId: room.id, doorIndex, levelId: level.id, label: `${roomLabel(room)}${room.doors.length > 1 ? ` (door ${doorIndex + 1})` : ""}` });
      });
    }
  }
  const entrances = view.building.entrances.filter((e) => !e.verified).map((e) => ({ entranceId: e.id, label: e.name }));
  const stairs = view.building.shafts
    .filter((s) => s.kind === "stair")
    .map((s) => ({
      shaftId: s.id,
      label: s.name ?? s.id.replace(/^.*-shaft-/, "Stair "),
      counted: (s.stepCounts ?? []).filter((n) => n !== null && n !== undefined).length,
      flights: s.nodeIds.length - 1,
    }))
    .filter((s) => s.counted < s.flights);
  return { doors, entrances, stairs, confirmed, total };
}

/** Where each door is drawn, in the building's metres. */
export function doorPoints(level: Level): { roomId: string; doorIndex: number; point: Point; verified: boolean }[] {
  const edges = new Map(level.edges.map((e) => [e.id, e]));
  const out: { roomId: string; doorIndex: number; point: Point; verified: boolean }[] = [];
  for (const room of level.rooms) {
    room.doors.forEach((door, doorIndex) => {
      const edge = edges.get(door.edgeId);
      if (edge?.polyline?.length) out.push({ roomId: room.id, doorIndex, point: doorMarker(edge.polyline, door.t, door.side), verified: !!door.verified });
    });
  }
  return out;
}

/**
 * What a tap at `p` hit. Small things win over big ones (a door over the room it is in), and the
 * reach is given in metres so the caller can scale it with the zoom, keeping a finger-sized target.
 */
export function pickAt(view: FieldView, levelId: string, p: Point, reachM: number): Selection | null {
  const level = view.levels.find((l) => l.id === levelId);
  if (!level) return null;
  const near = (q: Point) => Math.hypot(q[0] - p[0], q[1] - p[1]);

  let best: { s: Selection; d: number } | null = null;
  for (const d of doorPoints(level)) {
    const dist = near(d.point);
    if (dist <= reachM && (!best || dist < best.d)) best = { s: { kind: "door", roomId: d.roomId, doorIndex: d.doorIndex }, d: dist };
  }
  if (best) return best.s;

  const nodes = new Map(level.nodes.map((n) => [n.id, n]));
  for (const e of view.building.entrances) {
    const n = nodes.get(e.nodeId);
    if (!n) continue;
    const dist = near([n.x, n.y]);
    if (dist <= reachM && (!best || dist < best.d)) best = { s: { kind: "entrance", entranceId: e.id }, d: dist };
  }
  for (const shaft of view.building.shafts) {
    for (const nodeId of shaft.nodeIds) {
      const n = nodes.get(nodeId);
      if (!n) continue;
      const dist = near([n.x, n.y]);
      if (dist <= reachM && (!best || dist < best.d)) best = { s: { kind: "shaft", shaftId: shaft.id, nodeId }, d: dist };
    }
  }
  if (best) return best.s;

  // The smallest room containing the tap: a suite's inner room before the outline of its host.
  const area = (poly: Point[]) => Math.abs(poly.reduce((a, q, i) => a + (poly[(i + 1) % poly.length]![0] - q[0]) * (poly[(i + 1) % poly.length]![1] + q[1]), 0)) / 2;
  const inside = level.rooms.filter((r) => inPolygon(r.polygon, p)).sort((a, b) => area(a.polygon) - area(b.polygon))[0];
  if (inside) return { kind: "room", roomId: inside.id };

  for (const edge of level.edges) {
    if (!edge.polyline || edge.kind !== "corridor") continue;
    const proj = projectOnPolyline(edge.polyline, p);
    if (proj.distance <= reachM && (!best || proj.distance < best.d)) best = { s: { kind: "edge", edgeId: edge.id }, d: proj.distance };
  }
  return best?.s ?? null;
}

/** The corridor nearest a tap, as the door position it would make. */
export function nearestCorridor(level: Level, p: Point): { edgeId: string; t: number; side: "left" | "right"; distance: number } | null {
  let best: { edgeId: string; t: number; side: "left" | "right"; distance: number } | null = null;
  for (const edge of level.edges) {
    if (!edge.polyline || edge.kind !== "corridor") continue;
    const proj = projectOnPolyline(edge.polyline, p);
    if (!best || proj.distance < best.distance) best = { edgeId: edge.id, t: Math.round(proj.t * 10000) / 10000, side: proj.side, distance: proj.distance };
  }
  return best;
}
