/** A* and Dijkstra over the routing graph. Costs are seconds; see PLAN.md §7. */
import type { GraphEdge, GraphNode, RouteGraph } from "./graph";
import { resolveEndpoint } from "./graph";

/** Walking speed used for time estimates, m/s. */
export const WALK_SPEED_MPS = 1.3;
/** Climbing one level on foot: a fixed cost for the flights plus the vertical distance. */
export const STAIR_SECONDS_PER_LEVEL = 12;
export const STAIR_CLIMB_MPS = 0.4;
export const ELEVATOR_WAIT_SECONDS = 45;
export const ELEVATOR_SECONDS_PER_LEVEL = 5;

export type Endpoint = { type: "room"; id: string } | { type: "entrance"; id: string } | { type: "node"; id: string };

export interface RouteOptions {
  /** Exclude stairs and non-accessible entrances. */
  accessible?: boolean;
  /** Allow edges behind a card reader (default false). `locked` is never allowed. */
  allowCard?: boolean;
  /** Allow edges with restricted hours (default true). */
  allowHours?: boolean;
}

export interface RouteStep {
  edge: GraphEdge;
  from: GraphNode;
  to: GraphNode;
  seconds: number;
}

export interface Route {
  steps: RouteStep[];
  nodes: GraphNode[];
  meters: number;
  seconds: number;
  /** Levels visited in order. */
  levelIds: string[];
}

function levelGap(graph: RouteGraph, edge: GraphEdge): number {
  const a = graph.nodes.get(edge.from);
  const b = graph.nodes.get(edge.to);
  return a && b ? Math.abs(b.z - a.z) : 0;
}

export function edgeSeconds(graph: RouteGraph, edge: GraphEdge): number {
  const climb = levelGap(graph, edge);
  if (edge.kind === "stair") return STAIR_SECONDS_PER_LEVEL * Math.abs(edge.levels || 1) + climb / STAIR_CLIMB_MPS;
  if (edge.kind === "elevator") return ELEVATOR_WAIT_SECONDS + ELEVATOR_SECONDS_PER_LEVEL * Math.abs(edge.levels || 1);
  return edge.meters / WALK_SPEED_MPS;
}

export function edgeAllowed(graph: RouteGraph, edge: GraphEdge, opts: RouteOptions): boolean {
  if (edge.access === "locked") return false;
  if (edge.access === "card" && !opts.allowCard) return false;
  if (edge.access === "hours" && opts.allowHours === false) return false;
  if (!opts.accessible) return true;
  if (edge.kind === "stair") return false;
  if (!edge.accessible) return false;
  // In accessible mode a route may not start or end at an entrance that isn't step-free.
  for (const id of [edge.from, edge.to]) {
    const entrance = graph.building.entrances.find((e) => e.nodeId === id);
    if (entrance && !entrance.accessible) return false;
  }
  return true;
}

/** Straight-line lower bound on the remaining time, in seconds. */
function heuristic(a: GraphNode, b: GraphNode): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / WALK_SPEED_MPS;
}

interface Search {
  cameFrom: Map<string, { edge: GraphEdge; from: string }>;
  cost: Map<string, number>;
}

function reconstruct(graph: RouteGraph, search: Search, startId: string, goalId: string): Route {
  const steps: RouteStep[] = [];
  let at = goalId;
  while (at !== startId) {
    const prev = search.cameFrom.get(at);
    if (!prev) break;
    const from = graph.nodes.get(prev.from)!;
    const to = graph.nodes.get(at)!;
    steps.unshift({ edge: prev.edge, from, to, seconds: edgeSeconds(graph, prev.edge) });
    at = prev.from;
  }
  const nodes = steps.length ? [steps[0]!.from, ...steps.map((s) => s.to)] : [graph.nodes.get(startId)!];
  const levelIds: string[] = [];
  for (const n of nodes) if (levelIds[levelIds.length - 1] !== n.levelId) levelIds.push(n.levelId);
  return {
    steps,
    nodes,
    meters: steps.reduce((m, s) => m + s.edge.meters, 0),
    seconds: steps.reduce((t, s) => t + s.seconds, 0),
    levelIds,
  };
}

/** A binary heap keyed by priority; small and allocation-light for graphs this size. */
class Heap {
  private items: { id: string; p: number }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(id: string, p: number): void {
    this.items.push({ id, p });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]!.p <= this.items[i]!.p) break;
      [this.items[parent], this.items[i]] = [this.items[i]!, this.items[parent]!];
      i = parent;
    }
  }
  pop(): { id: string; p: number } | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let small = i;
        if (l < this.items.length && this.items[l]!.p < this.items[small]!.p) small = l;
        if (r < this.items.length && this.items[r]!.p < this.items[small]!.p) small = r;
        if (small === i) break;
        [this.items[small], this.items[i]] = [this.items[i]!, this.items[small]!];
        i = small;
      }
    }
    return top;
  }
}

export type RouteResult = { ok: true; route: Route } | { ok: false; error: string };

export function route(graph: RouteGraph, from: Endpoint, to: Endpoint, opts: RouteOptions = {}): RouteResult {
  const a = resolveEndpoint(graph, from);
  const b = resolveEndpoint(graph, to);
  if ("error" in a) return { ok: false, error: a.error };
  if ("error" in b) return { ok: false, error: b.error };
  if (a.nodeId === b.nodeId) return { ok: true, route: reconstruct(graph, { cameFrom: new Map(), cost: new Map() }, a.nodeId, a.nodeId) };

  const goal = graph.nodes.get(b.nodeId)!;
  const search: Search = { cameFrom: new Map(), cost: new Map([[a.nodeId, 0]]) };
  const open = new Heap();
  open.push(a.nodeId, heuristic(graph.nodes.get(a.nodeId)!, goal));
  const done = new Set<string>();

  while (open.size) {
    const current = open.pop()!;
    if (current.id === b.nodeId) return { ok: true, route: reconstruct(graph, search, a.nodeId, b.nodeId) };
    if (done.has(current.id)) continue;
    done.add(current.id);
    for (const edge of graph.adjacency.get(current.id) ?? []) {
      if (!edgeAllowed(graph, edge, opts)) continue;
      const next = graph.nodes.get(edge.to);
      if (!next) continue;
      const cost = (search.cost.get(current.id) ?? Infinity) + edgeSeconds(graph, edge);
      if (cost >= (search.cost.get(edge.to) ?? Infinity)) continue;
      search.cost.set(edge.to, cost);
      search.cameFrom.set(edge.to, { edge, from: current.id });
      open.push(edge.to, cost + heuristic(next, goal));
    }
  }
  return { ok: false, error: reachabilityMessage(graph, from, to, opts) };
}

function label(graph: RouteGraph, e: Endpoint): string {
  if (e.type === "room") {
    const room = graph.rooms.get(e.id);
    return room ? `room ${room.number ?? room.name ?? room.id}` : e.id;
  }
  if (e.type === "entrance") return graph.building.entrances.find((x) => x.id === e.id)?.name ?? e.id;
  return e.id;
}

function reachabilityMessage(graph: RouteGraph, from: Endpoint, to: Endpoint, opts: RouteOptions): string {
  const base = `No route from ${label(graph, from)} to ${label(graph, to)}`;
  if (opts.accessible) {
    const anyway = route(graph, from, to, { ...opts, accessible: false });
    if (anyway.ok) return `${base} without stairs. There is a route using stairs.`;
  }
  return `${base}. The two are not connected on the plan.`;
}
