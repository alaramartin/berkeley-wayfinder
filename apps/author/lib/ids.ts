import type { Proposal } from "@wf/schema";

/** Next free id like `wheeler-L1-n052` for a letter prefix, scanning nodes, edges and rooms. */
export function nextId(p: Proposal, letter: string): string {
  const prefix = `${p.buildingId}-${p.levelId}-${letter}`;
  const all = [...p.nodes.map((n) => n.id), ...p.edges.map((e) => e.id), ...p.rooms.map((r) => r.id), ...(p.entrances ?? []).map((e) => e.id)];
  let max = 0;
  for (const id of all) {
    if (!id.startsWith(prefix)) continue;
    const m = /^(\d+)/.exec(id.slice(prefix.length));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export function roomIdForNumber(p: Proposal, number: string): string {
  const safe = number.replace(/[^A-Za-z0-9]/g, "");
  return `${p.buildingId}-${p.levelId}-r${safe}`;
}
