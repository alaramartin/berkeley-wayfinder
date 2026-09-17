/** Proposal (image px) -> canonical Level (building-local meters), plus the checks that gate acceptance. */
import { imageToWorld } from "@wf/geometry";
import {
  Level,
  type Point,
  type Poi,
  type Proposal,
  type ReviewItem,
  type Similarity,
} from "@wf/schema";
import { components } from "./graph";
import { centroid } from "./polygon";

const NEEDS_IDENTITY = new Set(["classroom", "computer-lab", "seminar", "library", "office", "lactation", "auditorium", "other", "restroom"]);

export interface LevelMeta {
  sortIndex: number;
  displayName: string;
  elevationM: number;
  heightM: number;
  heightSource: "default" | "stair-count" | "measured";
  verified: boolean;
}

/** Reasons a proposal can't be accepted yet. Empty = ready. */
export function acceptBlockers(p: Proposal, queue: ReviewItem[], opts: { allowComponents?: number } = {}): string[] {
  const out: string[] = [];
  const open = queue.filter((i) => !i.resolved).length;
  if (open) out.push(`${open} review item(s) unresolved`);
  const unnamed = p.rooms.filter((r) => NEEDS_IDENTITY.has(r.category) && !r.number && !r.name);
  if (unnamed.length) out.push(`${unnamed.length} room(s) with neither number nor name: ${unnamed.slice(0, 5).map((r) => r.id).join(", ")}`);
  const numbers = p.rooms.map((r) => r.number).filter(Boolean);
  const dupes = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))];
  if (dupes.length) out.push(`duplicate room numbers: ${dupes.join(", ")}`);
  const comps = components(p).length;
  if (comps > (opts.allowComponents ?? 1)) out.push(`corridor graph has ${comps} disconnected pieces`);
  const edgeIds = new Set(p.edges.map((e) => e.id));
  const doorless = p.rooms.filter((r) => NEEDS_IDENTITY.has(r.category) && !r.doors.some((d) => edgeIds.has(d.edgeId)));
  if (doorless.length) out.push(`${doorless.length} room(s) without a valid door: ${doorless.slice(0, 5).map((r) => r.number ?? r.id).join(", ")}`);
  return out;
}

export function proposalToLevel(p: Proposal, meta: LevelMeta, imageTransform: Similarity): Level {
  const w = (pt: Point): Point => {
    const [x, y] = imageToWorld(imageTransform, pt);
    return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
  };
  const nodes = p.nodes.map((n) => {
    const [x, y] = w([n.x, n.y]);
    return { id: n.id, levelId: p.levelId, x, y, kind: n.kind, verified: false };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = p.edges.map((e) => ({
    id: e.id,
    a: e.a,
    b: e.b,
    kind: e.kind,
    polyline: e.polyline.map(w),
    accessible: true,
    access: "open" as const,
    verified: false,
  }));
  const rooms = p.rooms.map((r) => ({
    id: r.id,
    number: r.number,
    ...(r.name ? { name: r.name } : {}),
    aliases: r.aliases ?? [],
    category: r.category,
    ...(r.group ? { group: r.group } : {}),
    levelId: p.levelId,
    polygon: r.polygon.map(w),
    doors: r.doors.map((d) => ({ edgeId: d.edgeId, t: d.t, side: d.side, verified: false })),
    ...(r.restroom ? { restroom: r.restroom } : {}),
  }));

  const pois: Poi[] = [];
  for (const r of rooms) {
    if (r.category === "restroom") {
      const kind = r.restroom?.gender === "all" ? "gender-inclusive-restroom" : r.restroom?.accessible ? "accessible-restroom" : "restroom";
      pois.push({ id: `${r.id}-poi`, kind, levelId: p.levelId, roomId: r.id });
    }
    if (r.category === "lactation") pois.push({ id: `${r.id}-poi`, kind: "lactation", levelId: p.levelId, roomId: r.id });
  }
  for (const n of nodes) if (n.kind === "elevator") pois.push({ id: `${n.id}-poi`, kind: "elevator", levelId: p.levelId, nodeId: n.id });
  for (const icon of p.icons) {
    if (icon.kind !== "evac-chair" && icon.kind !== "dwa") continue;
    const at = w(icon.at);
    let nearest: string | undefined;
    let best = Infinity;
    for (const n of nodeById.values()) {
      const d = Math.hypot(n.x - at[0], n.y - at[1]);
      if (d < best) [best, nearest] = [d, n.id];
    }
    if (nearest) pois.push({ id: `${icon.id}-poi`, kind: icon.kind, levelId: p.levelId, nodeId: nearest });
  }

  return Level.parse({
    id: p.levelId,
    buildingId: p.buildingId,
    sortIndex: meta.sortIndex,
    displayName: meta.displayName,
    elevationM: meta.elevationM,
    heightM: meta.heightM,
    heightSource: meta.heightSource,
    verified: meta.verified,
    outline: (p.outline ?? []).map(w),
    voids: (p.voids ?? []).map((v) => v.map(w)),
    imageTransform,
    nodes,
    edges,
    rooms,
    pois,
  });
}

/** Rough label position for a room (vertex centroid), in the same units as the polygon. */
export function roomLabelPoint(polygon: Point[]): Point {
  return centroid(polygon);
}
