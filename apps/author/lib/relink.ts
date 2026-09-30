/**
 * Re-attach stairs and lifts to the corridor they actually open onto.
 *
 * A stair or lift is a node with a short link to the corridor. When that link runs to a junction some
 * way along instead of to the nearest point of the corridor beside it, a route that ought to step
 * straight out of the lift walks to the junction and doubles back: on Wheeler's Level 3 the lift is 3.6 m
 * from room 315's door and the route was 10.5 m, turning twice.
 *
 * Works in proposal pixels, like the rest of the author tool, and reuses `splitEdge`, which re-bases
 * every door on the corridor it cuts so nothing else moves.
 */
import type { Point, Proposal } from "@wf/schema";
import { addEdge, deleteEdge, polylineLength, projectToEdge, splitEdge } from "./graph";

export interface RelinkOptions {
  /** Pixels per metre, so thresholds can be stated in metres. */
  pxPerM: number;
  /** The nearest corridor must be at least this much closer than the current link to be worth moving. */
  minGainM?: number;
  /** ...and no more than this fraction of the current link's length. */
  maxRatio?: number;
}

export interface Relinked {
  nodeId: string;
  kind: string;
  fromEdge: string;
  toEdge: string;
  linkBeforeM: number;
  linkAfterM: number;
}

export function relinkVertical(p: Proposal, options: RelinkOptions): { proposal: Proposal; changes: Relinked[] } {
  const minGain = options.minGainM ?? 1.5;
  const maxRatio = options.maxRatio ?? 0.7;
  let current = p;
  const changes: Relinked[] = [];

  for (const node of p.nodes) {
    if (node.kind !== "stair" && node.kind !== "elevator") continue;
    const incident = current.edges.filter((e) => e.a === node.id || e.b === node.id);
    // Only the common case: one link. A node already joined at two places is doing something on purpose.
    if (incident.length !== 1) continue;
    const link = incident[0]!;
    const linkLength = polylineLength(link.polyline);

    // The nearest point on any *other* corridor.
    let best: { edgeId: string; distance: number; point: Point } | null = null;
    for (const edge of current.edges) {
      if (edge.id === link.id) continue;
      const projection = projectToEdge(edge, [node.x, node.y]);
      if (!best || projection.distance < best.distance) best = { edgeId: edge.id, distance: projection.distance, point: projection.point };
    }
    if (!best) continue;
    const gainM = (linkLength - best.distance) / options.pxPerM;
    if (gainM < minGain || best.distance > linkLength * maxRatio) continue;

    // Split the corridor there, join the node to the new junction, and drop the long stub.
    const split = splitEdge(current, best.edgeId, best.point);
    let next = addEdge(split.proposal, node.id, split.nodeId);
    next = deleteEdge(next, link.id);
    current = next;
    changes.push({
      nodeId: node.id,
      kind: node.kind,
      fromEdge: link.id,
      toEdge: best.edgeId,
      linkBeforeM: linkLength / options.pxPerM,
      linkAfterM: best.distance / options.pxPerM,
    });
  }
  return { proposal: current, changes };
}
