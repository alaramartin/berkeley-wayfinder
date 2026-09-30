/**
 * Straightening corridor centrelines before they become canonical data.
 *
 * The centrelines are skeletonised from the paint on a placard photo, so they wander: Wheeler's L4
 * trunk runs 38.9 m along a 34.0 m chord. That inflates route distances, invents turns in the step
 * list, and makes the drawn route drift across the hallway.
 *
 * Two things make this delicate. A door is stored as a fraction along its edge's arc length, so moving
 * a line moves every door on it — one L4 edge carries 16. And a real corner must survive: wobble is a
 * direction change that reverses within a short run, a corner is one that persists.
 *
 * Works in proposal pixels, before the transform to metres, so `projectToEdge` and the door `side`
 * convention apply unchanged.
 */
import type { Point, Proposal, ProposalEdge, ProposalRoom } from "@wf/schema";
import { pointAt, polylineLength, projectToEdge } from "./graph";
import { centroid } from "@wf/geometry";

export interface StraightenOptions {
  /** Pixels per metre, so every threshold below can be stated in metres. */
  pxPerM: number;
  /** A segment within this of an axis is treated as running along it. */
  axisToleranceDeg?: number;
  /** An off-axis wiggle shorter than this between two axis runs is skeleton noise. */
  absorbDiagonalM?: number;
  /** A run must be at least this long to define a corner. */
  minRunM?: number;
  /** Two runs on the same axis further apart than this keep their jog instead of merging. */
  jogToleranceM?: number;
  /** If any point would move further than this, the edge is left alone. */
  maxPointMoveM?: number;
  /** A corridor bowing to one side may be pulled straight by this much; it is a tracing artifact. */
  bowToleranceM?: number;
  /** Doors that end up this much further from their room than before are reported for review. */
  doorFlagM?: number;
  /** Wobble smaller than this is dropped before the corridor is classified. */
  simplifyM?: number;
  /** Nodes that must not move: shaft members and entrances. */
  pinnedNodeIds?: Set<string>;
}

export interface DoorChange {
  roomId: string;
  roomNumber: string | null;
  edgeId: string;
  movedPx: number;
  movedM: number;
  sideBefore: "left" | "right";
  sideAfter: "left" | "right";
}

export interface EdgeChange {
  edgeId: string;
  skipped?: "link" | "vertical-endpoint" | "two-point";
  vetoed?: string;
  lengthBeforeM: number;
  lengthAfterM: number;
  chordM: number;
  maxMoveM: number;
}

export interface StraightenReport {
  levelId: string;
  axisDeg: number;
  edges: EdgeChange[];
  doors: DoorChange[];
  totals: {
    corridorBeforeM: number;
    corridorAfterM: number;
    maxMoveM: number;
    doorsFlagged: number;
    sideFlips: number;
    edgesChanged: number;
    edgesSkipped: number;
    edgesVetoed: number;
  };
}

const DEG = Math.PI / 180;

/** Length-weighted direction of the outline, folded into a quarter turn: the building's own axis. */
export function dominantAxis(p: Proposal): number {
  const ring: Point[] = (p.outline?.length ?? 0) >= 3 ? p.outline! : p.edges.flatMap((e) => e.polyline);
  let sin = 0;
  let cos = 0;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1]!;
    const [bx, by] = ring[i]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1) continue;
    // Angles mod 90 degrees: a wall and the wall at right angles to it agree about the axis.
    const angle = Math.atan2(by - ay, bx - ax) * 4;
    sin += Math.sin(angle) * length;
    cos += Math.cos(angle) * length;
  }
  if (sin === 0 && cos === 0) return 0;
  return Math.atan2(sin, cos) / 4;
}

type Run = { kind: "along" | "across" | "free"; points: Point[]; length: number };

/** Ramer-Douglas-Peucker: drop the pixel-level zigzag the skeletoniser leaves behind. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const span = Math.hypot(last[0] - first[0], last[1] - first[1]);
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const d =
      span === 0
        ? Math.hypot(p[0] - first[0], p[1] - first[1])
        : Math.abs((last[0] - first[0]) * (first[1] - p[1]) - (first[0] - p[0]) * (last[1] - first[1])) / span;
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

function classify(a: Point, b: Point, axis: number, tolerance: number): Run["kind"] {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) - axis;
  const folded = Math.abs(((angle % Math.PI) + Math.PI + Math.PI / 2) % Math.PI) - Math.PI / 2;
  if (Math.abs(folded) <= tolerance) return "along";
  if (Math.abs(Math.abs(folded) - Math.PI / 2) <= tolerance) return "across";
  return "free";
}

/** Fit a run to an exact axis line: the length-weighted mean offset across the axis. */
function fitRun(run: Run, direction: [number, number]): { origin: Point; direction: [number, number] } {
  const normal: [number, number] = [-direction[1], direction[0]];
  let weighted = 0;
  let total = 0;
  for (let i = 1; i < run.points.length; i++) {
    const a = run.points[i - 1]!;
    const b = run.points[i]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    weighted += (mid[0] * normal[0] + mid[1] * normal[1]) * length;
    total += length;
  }
  const offset = total === 0 ? 0 : weighted / total;
  return { origin: [normal[0] * offset, normal[1] * offset], direction };
}

function intersect(a: { origin: Point; direction: [number, number] }, b: { origin: Point; direction: [number, number] }): Point | null {
  const determinant = a.direction[0] * -b.direction[1] - a.direction[1] * -b.direction[0];
  if (Math.abs(determinant) < 1e-9) return null;
  const dx = b.origin[0] - a.origin[0];
  const dy = b.origin[1] - a.origin[1];
  const t = (dx * -b.direction[1] - dy * -b.direction[0]) / determinant;
  return [a.origin[0] + a.direction[0] * t, a.origin[1] + a.direction[1] * t];
}

const project = (line: { origin: Point; direction: [number, number] }, p: Point): Point => {
  const t = (p[0] - line.origin[0]) * line.direction[0] + (p[1] - line.origin[1]) * line.direction[1];
  return [line.origin[0] + line.direction[0] * t, line.origin[1] + line.direction[1] * t];
};

/** The straightened polyline for one edge, or null to leave it alone. */
function straightenPolyline(original: Point[], axis: number, o: Required<Pick<StraightenOptions, "pxPerM" | "axisToleranceDeg" | "absorbDiagonalM" | "minRunM" | "jogToleranceM" | "simplifyM" | "maxPointMoveM" | "bowToleranceM">>): Point[] | null {
  if (original.length < 3) return null;
  // Wobble first: a staircase of short alternating diagonals has no segment on the axis at all, so
  // classifying before simplifying would call the whole corridor "free" and leave it as traced.
  const polyline = simplify(original, o.simplifyM * o.pxPerM);
  if (polyline.length < 2) return null;
  const tolerance = o.axisToleranceDeg * DEG;
  const absorb = o.absorbDiagonalM * o.pxPerM;
  const minRun = o.minRunM * o.pxPerM;
  const jog = o.jogToleranceM * o.pxPerM;

  // The common case by far: a corridor that runs one way and only wanders about it. If the line from
  // end to end sits on an axis and nothing strays further than we are willing to move, fit the whole
  // edge at once. A real L-bend has a diagonal chord, so it never matches this and falls through.
  // Note on what "straight" means here: a corridor runs *between* two rows of rooms, so its line is
  // not the chord between the junctions at its ends. On L4's trunk the rooms either side are straight
  // to within 0.45 m while the traced centreline wanders 1.1 m, and the chord would cut through the
  // rooms on one side. So the long runs are fitted at their own offset and the end nodes, which are
  // shared with other corridors and must not move, are joined to that line by a short connector.

  // Group consecutive segments that run the same way.
  const runs: Run[] = [];
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1]!;
    const b = polyline[i]!;
    const kind = classify(a, b, axis, tolerance);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) {
      last.points.push(b);
      last.length += length;
    } else {
      runs.push({ kind, points: [a, b], length });
    }
  }

  // A short wiggle between two runs of one kind is skeleton noise: absorb it.
  for (let i = 1; i < runs.length - 1; i++) {
    const previous = runs[i - 1]!;
    const run = runs[i]!;
    const next = runs[i + 1]!;
    if (run.length <= absorb && previous.kind === next.kind && run.kind !== previous.kind) {
      previous.points.push(...run.points.slice(1), ...next.points.slice(1));
      previous.length += run.length + next.length;
      runs.splice(i, 2);
      i -= 1;
    }
  }

  // Merge neighbouring runs of the same kind unless they sit at genuinely different offsets (a jog).
  const axisDirection = (kind: Run["kind"]): [number, number] | null =>
    kind === "along" ? [Math.cos(axis), Math.sin(axis)] : kind === "across" ? [-Math.sin(axis), Math.cos(axis)] : null;
  for (let i = 0; i < runs.length - 1; i++) {
    const run = runs[i]!;
    const next = runs[i + 1]!;
    const direction = axisDirection(run.kind);
    if (!direction || run.kind !== next.kind) continue;
    const a = fitRun(run, direction);
    const b = fitRun(next, direction);
    const normal: [number, number] = [-direction[1], direction[0]];
    const gap = Math.abs((a.origin[0] - b.origin[0]) * normal[0] + (a.origin[1] - b.origin[1]) * normal[1]);
    if (gap > jog) continue;
    run.points.push(...next.points.slice(1));
    run.length += next.length;
    runs.splice(i + 1, 1);
    i -= 1;
  }

  // A run too short to define a corner cannot stand on its own; treat it as free geometry.
  const fitted = runs.map((run) => {
    const direction = axisDirection(run.kind);
    return direction && run.length >= minRun ? { run, line: fitRun(run, direction) } : { run, line: null };
  });
  if (!fitted.some((f) => f.line)) return null;

  const out: Point[] = [polyline[0]!];
  for (let i = 0; i < fitted.length; i++) {
    const here = fitted[i]!;
    const next = fitted[i + 1];
    if (!here.line) {
      // Keep free geometry verbatim.
      out.push(...here.run.points.slice(1));
      continue;
    }
    // Start of a fitted run: project the previous point onto its line.
    out[out.length - 1] = project(here.line, out[out.length - 1]!);
    if (!next) {
      out.push(project(here.line, here.run.points[here.run.points.length - 1]!));
      continue;
    }
    if (next.line) {
      const corner = intersect(here.line, next.line);
      out.push(corner ?? project(here.line, here.run.points[here.run.points.length - 1]!));
    } else {
      out.push(project(here.line, here.run.points[here.run.points.length - 1]!));
    }
  }
  return out.length >= 2 ? out : null;
}

/**
 * Edges that must keep their geometry exactly.
 *
 * Node positions are never at risk: every straightened polyline keeps its original first and last
 * point, so a stairwell cannot be dragged out of its shaft however the middle is refitted. What has to
 * be protected is geometry that is *meant* to be diagonal — the short spurs that run from a corridor
 * to a shaft centroid — and two-point edges, which are already straight and would only be rotated.
 */
function skipReason(edge: ProposalEdge, p: Proposal, pinned: Set<string>): EdgeChange["skipped"] | null {
  if (edge.id.includes("-link")) return "link";
  const kindOf = (id: string) => p.nodes.find((n) => n.id === id)?.kind;
  const spur = edge.polyline.length < 3 && (kindOf(edge.a) === "stair" || kindOf(edge.a) === "elevator" || kindOf(edge.b) === "stair" || kindOf(edge.b) === "elevator");
  if (spur) return "vertical-endpoint";
  if (pinned.has(edge.a) && pinned.has(edge.b)) return "vertical-endpoint";
  // A two-point edge is a chord between two fixed nodes: there is no wobble to remove, and it would
  // only be rotated. L1 has genuine corridors at 8-30 degrees to the axis.
  if (edge.polyline.length < 3) return "two-point";
  return null;
}

export function straightenEdges(p: Proposal, axis: number, options: StraightenOptions): { proposal: Proposal; report: StraightenReport } {
  const o = {
    axisToleranceDeg: 20,
    absorbDiagonalM: 1.2,
    minRunM: 2,
    jogToleranceM: 0.6,
    simplifyM: 0.35,
    maxPointMoveM: 1.5,
    bowToleranceM: 4,
    doorFlagM: 0.5,
    pinnedNodeIds: new Set<string>(),
    ...options,
  };
  const toM = (px: number) => px / o.pxPerM;
  const report: StraightenReport = {
    levelId: p.levelId,
    axisDeg: (axis / DEG + 360) % 90,
    edges: [],
    doors: [],
    totals: { corridorBeforeM: 0, corridorAfterM: 0, maxMoveM: 0, doorsFlagged: 0, sideFlips: 0, edgesChanged: 0, edgesSkipped: 0, edgesVetoed: 0 },
  };

  // Capture every door's world point against the OLD geometry, before anything moves.
  const byEdge = new Map<string, ProposalEdge>(p.edges.map((e) => [e.id, e]));
  const anchors: { room: ProposalRoom; index: number; edgeId: string; at: Point; roomAt: Point }[] = [];
  for (const room of p.rooms) {
    room.doors.forEach((door, index) => {
      const edge = byEdge.get(door.edgeId);
      if (!edge) return;
      anchors.push({ room, index, edgeId: door.edgeId, at: pointAt(edge.polyline, door.t), roomAt: centroid(room.polygon) });
    });
  }

  const edges = p.edges.map((edge) => {
    const before = polylineLength(edge.polyline);
    report.totals.corridorBeforeM += toM(before);
    const skipped = skipReason(edge, p, o.pinnedNodeIds);
    if (skipped) {
      report.totals.edgesSkipped += 1;
      report.totals.corridorAfterM += toM(before);
      report.edges.push({ edgeId: edge.id, skipped, lengthBeforeM: toM(before), lengthAfterM: toM(before), chordM: toM(chord(edge.polyline)), maxMoveM: 0 });
      return edge;
    }

    const straightened = straightenPolyline(edge.polyline, axis, o);
    if (!straightened) {
      report.totals.edgesSkipped += 1;
      report.totals.corridorAfterM += toM(before);
      report.edges.push({ edgeId: edge.id, skipped: "two-point", lengthBeforeM: toM(before), lengthAfterM: toM(before), chordM: toM(chord(edge.polyline)), maxMoveM: 0 });
      return edge;
    }
    // The end nodes are shared with other corridors and must not move, but the straight run sits at
    // its own offset between the rooms, so the node is joined to it by a short connector rather than
    // dragging the whole line back onto the chord.
    const first = edge.polyline[0]!;
    const last = edge.polyline[edge.polyline.length - 1]!;
    const apart = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6;
    if (apart(straightened[0]!, first)) straightened.unshift(first);
    else straightened[0] = first;
    if (apart(straightened[straightened.length - 1]!, last)) straightened.push(last);
    else straightened[straightened.length - 1] = last;

    const moved = Math.max(...edge.polyline.map((point) => nearestDistance(point, straightened)));
    const entry: EdgeChange = {
      edgeId: edge.id,
      lengthBeforeM: toM(before),
      lengthAfterM: toM(polylineLength(straightened)),
      chordM: toM(chord(edge.polyline)),
      maxMoveM: toM(moved),
    };
    if (toM(moved) > o.bowToleranceM) {
      // Something was classified wrongly; better to leave this corridor as traced.
      entry.vetoed = `a point would move ${toM(moved).toFixed(1)} m`;
      entry.lengthAfterM = entry.lengthBeforeM;
      report.totals.edgesVetoed += 1;
      report.totals.corridorAfterM += toM(before);
      report.edges.push(entry);
      return edge;
    }
    report.totals.edgesChanged += 1;
    report.totals.maxMoveM = Math.max(report.totals.maxMoveM, toM(moved));
    report.totals.corridorAfterM += entry.lengthAfterM;
    report.edges.push(entry);
    return { ...edge, polyline: straightened };
  });

  // Re-derive every door against the new geometry.
  const newByEdge = new Map(edges.map((e) => [e.id, e]));
  const doorsByRoom = new Map<string, { t: number; side: "left" | "right" }[]>();
  for (const anchor of anchors) {
    const edge = newByEdge.get(anchor.edgeId)!;
    const moved = projectToEdge(edge, anchor.at);
    // `side` comes from the room, never from the captured point: that point lay on the old centreline,
    // so once the line shifts its side is meaningless.
    const fromRoom = projectToEdge(edge, anchor.roomAt);
    const before = anchor.room.doors[anchor.index]!;
    const list = doorsByRoom.get(anchor.room.id) ?? [];
    list[anchor.index] = { t: moved.t, side: fromRoom.side };
    doorsByRoom.set(anchor.room.id, list);

    // What matters is not how far the centreline moved — that is the whole point of straightening —
    // but whether the door ended up further from its own room than it started.
    const distanceToRoom = (p: Point) => Math.hypot(p[0] - anchor.roomAt[0], p[1] - anchor.roomAt[1]);
    const oldEdge = byEdge.get(anchor.edgeId)!;
    const shift = Math.max(0, distanceToRoom(moved.point) - distanceToRoom(pointAt(oldEdge.polyline, before.t)));
    if (toM(shift) > o.doorFlagM || fromRoom.side !== before.side) {
      report.doors.push({
        roomId: anchor.room.id,
        roomNumber: anchor.room.number,
        edgeId: anchor.edgeId,
        movedPx: shift,
        movedM: toM(shift),
        sideBefore: before.side,
        sideAfter: fromRoom.side,
      });
      if (toM(shift) > o.doorFlagM) report.totals.doorsFlagged += 1;
      if (fromRoom.side !== before.side) report.totals.sideFlips += 1;
    }
  }

  const rooms = p.rooms.map((room) => {
    const updates = doorsByRoom.get(room.id);
    if (!updates) return room;
    return { ...room, doors: room.doors.map((door, i) => (updates[i] ? { ...door, t: updates[i]!.t, side: updates[i]!.side } : door)) };
  });

  return { proposal: { ...p, edges, rooms }, report };
}

function chord(line: Point[]): number {
  const a = line[0]!;
  const b = line[line.length - 1]!;
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function nearestDistance(point: Point, line: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const u = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(point[0] - (a[0] + dx * u), point[1] - (a[1] + dy * u)));
  }
  return best;
}
