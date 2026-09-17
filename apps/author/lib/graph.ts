/** Editing operations on a proposal's corridor graph (image pixels). All functions return new objects. */
import type { Point, Proposal, ProposalEdge, ProposalNode } from "@wf/schema";
import { nextId } from "./ids";

export interface EdgeProjection {
  edgeId: string;
  point: Point;
  /** Fraction of the edge's polyline length from a to b. */
  t: number;
  distance: number;
  /** Side of the edge (walking a -> b) in map orientation: image y is flipped. */
  side: "left" | "right";
}

export function polylineLength(line: Point[]): number {
  let len = 0;
  for (let i = 1; i < line.length; i++) len += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  return len;
}

export function pointAt(line: Point[], t: number): Point {
  const target = Math.min(Math.max(t, 0), 1) * polylineLength(line);
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!;
    const [bx, by] = line[i]!;
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg > 0 && walked + seg >= target) {
      const f = (target - walked) / seg;
      return [ax + (bx - ax) * f, ay + (by - ay) * f];
    }
    walked += seg;
  }
  return line[line.length - 1]!;
}

export function projectToEdge(edge: ProposalEdge, q: Point): EdgeProjection {
  const pts = edge.polyline;
  const total = polylineLength(pts);
  let best: EdgeProjection | null = null;
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const u = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((q[0] - ax) * dx + (q[1] - ay) * dy) / l2));
    const c: Point = [ax + u * dx, ay + u * dy];
    const distance = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const seg = Math.sqrt(l2);
    if (!best || distance < best.distance) {
      const cross = dx * -(q[1] - c[1]) - -dy * (q[0] - c[0]);
      best = { edgeId: edge.id, point: c, t: total === 0 ? 0 : (walked + u * seg) / total, distance, side: cross > 0 ? "left" : "right" };
    }
    walked += seg;
  }
  return best ?? { edgeId: edge.id, point: pts[0]!, t: 0, distance: Infinity, side: "left" };
}

export function projectToGraph(p: Proposal, q: Point): EdgeProjection | null {
  let best: EdgeProjection | null = null;
  for (const e of p.edges) {
    const proj = projectToEdge(e, q);
    if (!best || proj.distance < best.distance) best = proj;
  }
  return best;
}

export function components(p: Proposal): string[][] {
  const parent = new Map(p.nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const e of p.edges) {
    if (parent.has(e.a) && parent.has(e.b)) parent.set(find(e.a), find(e.b));
  }
  const groups = new Map<string, string[]>();
  for (const n of p.nodes) {
    const r = find(n.id);
    groups.set(r, [...(groups.get(r) ?? []), n.id]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

export function moveNode(p: Proposal, nodeId: string, to: Point): Proposal {
  return {
    ...p,
    nodes: p.nodes.map((n) => (n.id === nodeId ? { ...n, x: to[0], y: to[1] } : n)),
    edges: p.edges.map((e) => {
      if (e.a !== nodeId && e.b !== nodeId) return e;
      const polyline = e.polyline.map((pt) => [...pt] as Point);
      if (e.a === nodeId) polyline[0] = to;
      if (e.b === nodeId) polyline[polyline.length - 1] = to;
      return { ...e, polyline };
    }),
  };
}

export function addNode(p: Proposal, at: Point, kind: ProposalNode["kind"] = "junction"): { proposal: Proposal; nodeId: string } {
  const id = nextId(p, "n");
  return { proposal: { ...p, nodes: [...p.nodes, { id, x: at[0], y: at[1], kind, confidence: 1 }] }, nodeId: id };
}

export function addEdge(p: Proposal, a: string, b: string): Proposal {
  if (a === b || p.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return p;
  const na = p.nodes.find((n) => n.id === a);
  const nb = p.nodes.find((n) => n.id === b);
  if (!na || !nb) return p;
  const id = nextId(p, "e");
  return { ...p, edges: [...p.edges, { id, a, b, kind: "corridor", polyline: [[na.x, na.y], [nb.x, nb.y]], confidence: 1 }] };
}

/** Insert a junction on an edge at the point closest to `at`; doors on that edge keep their physical position. */
export function splitEdge(p: Proposal, edgeId: string, at: Point): { proposal: Proposal; nodeId: string } {
  const edge = p.edges.find((e) => e.id === edgeId);
  if (!edge) throw new Error(`no edge ${edgeId}`);
  const proj = projectToEdge(edge, at);
  const total = polylineLength(edge.polyline);
  const cutAt = proj.t * total;
  const first: Point[] = [edge.polyline[0]!];
  const second: Point[] = [proj.point];
  let walked = 0;
  for (let i = 1; i < edge.polyline.length; i++) {
    const prev = edge.polyline[i - 1]!;
    const cur = edge.polyline[i]!;
    walked += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    if (walked < cutAt) first.push(cur);
    else second.push(cur);
  }
  first.push(proj.point);
  const { proposal: withNode, nodeId } = addNode(p, proj.point);
  const idA = nextId(withNode, "e");
  const withA = { ...withNode, edges: [...withNode.edges, { ...edge, id: idA, b: nodeId, polyline: first }] };
  const idB = nextId(withA, "e");
  const lenA = polylineLength(first);
  const lenB = polylineLength(second);
  const edges = [...withA.edges.filter((e) => e.id !== edgeId), { ...edge, id: idB, a: nodeId, polyline: second }];
  const rooms = withA.rooms.map((r) => ({
    ...r,
    doors: r.doors.map((d) => {
      if (d.edgeId !== edgeId) return d;
      const along = d.t * total;
      return along <= lenA
        ? { ...d, edgeId: idA, t: lenA === 0 ? 0 : along / lenA }
        : { ...d, edgeId: idB, t: lenB === 0 ? 0 : (along - lenA) / lenB };
    }),
  }));
  return { proposal: { ...withA, edges, rooms }, nodeId };
}

export function deleteEdge(p: Proposal, edgeId: string): Proposal {
  return {
    ...p,
    edges: p.edges.filter((e) => e.id !== edgeId),
    rooms: p.rooms.map((r) => ({ ...r, doors: r.doors.filter((d) => d.edgeId !== edgeId) })),
  };
}

export function deleteNode(p: Proposal, nodeId: string): Proposal {
  let out: Proposal = { ...p, nodes: p.nodes.filter((n) => n.id !== nodeId), entrances: (p.entrances ?? []).filter((e) => e.nodeId !== nodeId) };
  for (const e of p.edges) if (e.a === nodeId || e.b === nodeId) out = deleteEdge(out, e.id);
  return out;
}

export function setNodeKind(p: Proposal, nodeId: string, kind: ProposalNode["kind"]): Proposal {
  return { ...p, nodes: p.nodes.map((n) => (n.id === nodeId ? { ...n, kind } : n)) };
}

/** Place (or replace) a room's door at the corridor point nearest `at`. */
export function setDoor(p: Proposal, roomId: string, at: Point, doorIndex = 0): Proposal {
  const proj = projectToGraph(p, at);
  if (!proj) return p;
  const door = { edgeId: proj.edgeId, t: proj.t, side: proj.side, confidence: 1 };
  return {
    ...p,
    rooms: p.rooms.map((r) => {
      if (r.id !== roomId) return r;
      const doors = [...r.doors];
      if (doorIndex < doors.length) doors[doorIndex] = door;
      else doors.push(door);
      return { ...r, doors };
    }),
  };
}

export function doorPoint(p: Proposal, door: { edgeId: string; t: number }): Point | null {
  const e = p.edges.find((x) => x.id === door.edgeId);
  return e ? pointAt(e.polyline, door.t) : null;
}
