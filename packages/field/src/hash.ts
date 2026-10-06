/**
 * A fingerprint of the parts of the data a field patch can change, so the importer can tell whether
 * the patch was made against the data it is now being applied to.
 *
 * Deliberately not the whole files: polygons, coordinates and elevations change whenever the author
 * touches a level, and none of that makes a patch's door and room edits stale. It covers what the ops
 * name: rooms (id, number, doors), corridor access, entrances and step counts.
 */
import type { FieldData } from "./apply";

/** cyrb53: small, synchronous, and the same in a browser and in Node (crypto.subtle is async and secure-context only). */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function hashFieldData(data: FieldData): string {
  const state = {
    rooms: [...data.rooms]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => [r.id, r.number, r.doors.map((d) => [d.edgeId, round(d.t), d.side, d.verified ? 1 : 0])]),
    edges: [...data.edges].sort((a, b) => a.id.localeCompare(b.id)).map((e) => [e.id, e.access ?? "open"]),
    entrances: [...data.entrances].sort((a, b) => a.id.localeCompare(b.id)).map((e) => [e.id, e.accessible ? 1 : 0, e.verified ? 1 : 0]),
    shafts: [...data.shafts].sort((a, b) => a.id.localeCompare(b.id)).map((s) => [s.id, s.nodeIds.length, s.stepCounts ?? []]),
  };
  return cyrb53(JSON.stringify(state));
}
