/** Nearest point of interest: Dijkstra from the start until the first POI of the wanted kind. */
import type { PoiKind } from "@wf/schema";
import type { RouteGraph } from "./graph";
import { resolveEndpoint, roomNodeId } from "./graph";
import type { Endpoint, Route, RouteOptions } from "./route";
import { edgeAllowed, edgeSeconds, route } from "./route";

export interface NearestResult {
  ok: true;
  route: Route;
  /** The POI reached, and the room it belongs to when it has one. */
  poiId: string;
  roomId?: string;
  nodeId: string;
}

/** Asking for a restroom should find the accessible and all-gender ones too. */
export const POI_FAMILIES: Partial<Record<PoiKind, PoiKind[]>> = {
  restroom: ["restroom", "accessible-restroom", "gender-inclusive-restroom"],
  "accessible-restroom": ["accessible-restroom"],
  "gender-inclusive-restroom": ["gender-inclusive-restroom"],
};

export function poiKinds(kind: PoiKind | PoiKind[]): PoiKind[] {
  if (Array.isArray(kind)) return kind;
  return POI_FAMILIES[kind] ?? [kind];
}

/** POI nodes, as graph node ids: a POI is either a node or a room. */
function poiTargets(graph: RouteGraph, kind: PoiKind | PoiKind[]): Map<string, { poiId: string; roomId?: string }> {
  const wanted = new Set(poiKinds(kind));
  const out = new Map<string, { poiId: string; roomId?: string }>();
  for (const level of graph.levels.values()) {
    for (const poi of level.pois) {
      if (!wanted.has(poi.kind)) continue;
      const id = poi.roomId ? roomNodeId(poi.roomId) : poi.nodeId;
      if (id && graph.nodes.has(id)) out.set(id, { poiId: poi.id, roomId: poi.roomId });
    }
  }
  return out;
}

export function nearest(graph: RouteGraph, from: Endpoint, kind: PoiKind | PoiKind[], opts: RouteOptions = {}): NearestResult | { ok: false; error: string } {
  const start = resolveEndpoint(graph, from);
  if ("error" in start) return { ok: false, error: start.error };
  const targets = poiTargets(graph, kind);
  const label = poiKinds(kind)[0]!.replace(/-/g, " ");
  if (!targets.size) return { ok: false, error: `this building has no ${label} recorded` };

  // Dijkstra outward; the first target settled is the closest by time.
  const cost = new Map<string, number>([[start.nodeId, 0]]);
  const queue: { id: string; c: number }[] = [{ id: start.nodeId, c: 0 }];
  const done = new Set<string>();
  while (queue.length) {
    queue.sort((a, b) => a.c - b.c);
    const current = queue.shift()!;
    if (done.has(current.id)) continue;
    done.add(current.id);
    const hit = targets.get(current.id);
    if (hit && current.id !== start.nodeId) {
      const node = graph.nodes.get(current.id)!;
      const leg = route(graph, from, node.roomId ? { type: "room", id: node.roomId } : { type: "node", id: current.id }, opts);
      if (!leg.ok) return leg;
      return { ok: true, route: leg.route, poiId: hit.poiId, roomId: hit.roomId, nodeId: current.id };
    }
    for (const edge of graph.adjacency.get(current.id) ?? []) {
      if (!edgeAllowed(graph, edge, opts)) continue;
      const next = current.c + edgeSeconds(graph, edge);
      if (next >= (cost.get(edge.to) ?? Infinity)) continue;
      cost.set(edge.to, next);
      queue.push({ id: edge.to, c: next });
    }
  }
  return { ok: false, error: `no ${label} is reachable from here${opts.accessible ? " without stairs" : ""}` };
}
