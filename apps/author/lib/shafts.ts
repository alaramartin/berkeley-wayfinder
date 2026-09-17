/** Propose vertical shafts (stairwells/elevators) by stacking same-kind nodes across levels in world meters. */
import type { Edge, Level, Shaft } from "@wf/schema";

export interface ShaftProposal {
  kind: "stair" | "elevator";
  nodeIds: string[];
  levelIds: string[];
  /** Largest horizontal offset between consecutive nodes, meters. */
  maxOffsetM: number;
}

export function proposeShafts(levels: Level[], maxDistanceM = 4, maxSkip = 1): ShaftProposal[] {
  const ordered = [...levels].sort((a, b) => a.sortIndex - b.sortIndex);
  const out: ShaftProposal[] = [];
  for (const kind of ["stair", "elevator"] as const) {
    const used = new Set<string>();
    const nodesOf = (lv: Level) => lv.nodes.filter((n) => n.kind === kind);
    for (let li = 0; li < ordered.length; li++) {
      for (const start of nodesOf(ordered[li]!)) {
        if (used.has(start.id)) continue;
        const chain = [start];
        const levelIds = [ordered[li]!.id];
        let maxOffset = 0;
        let cur = start;
        let lj = li + 1;
        while (lj < ordered.length) {
          let found = false;
          for (let skip = 0; skip <= maxSkip && lj + skip < ordered.length; skip++) {
            const lv = ordered[lj + skip]!;
            let best: (typeof start) | undefined;
            let bestD = Infinity;
            for (const n of nodesOf(lv)) {
              if (used.has(n.id)) continue;
              const d = Math.hypot(n.x - cur.x, n.y - cur.y);
              if (d < bestD) [bestD, best] = [d, n];
            }
            if (best && bestD <= maxDistanceM) {
              chain.push(best);
              levelIds.push(lv.id);
              maxOffset = Math.max(maxOffset, bestD);
              cur = best;
              lj = lj + skip + 1;
              found = true;
              break;
            }
          }
          if (!found) break;
        }
        if (chain.length >= 2) {
          for (const n of chain) used.add(n.id);
          out.push({ kind, nodeIds: chain.map((n) => n.id), levelIds, maxOffsetM: Math.round(maxOffset * 100) / 100 });
        }
      }
    }
  }
  return out;
}

export function shaftToGraph(buildingId: string, index: number, proposal: ShaftProposal): { shaft: Shaft; edges: Edge[] } {
  const id = `${buildingId}-shaft-${proposal.kind === "stair" ? "s" : "v"}${index}`;
  const edges: Edge[] = proposal.nodeIds.slice(1).map((b, i) => ({
    id: `${id}-e${i}`,
    a: proposal.nodeIds[i]!,
    b,
    kind: proposal.kind,
    accessible: proposal.kind === "elevator",
    access: "open",
    verified: false,
  }));
  return { shaft: { id, kind: proposal.kind, nodeIds: proposal.nodeIds }, edges };
}
