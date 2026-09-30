/**
 * Turning level data into scene numbers. Pure maths, so it can be tested without a canvas.
 *
 * Building-local metres are x east, y north, z up. Three.js is y up, so a point (x, y) on level L
 * becomes [x, height(L), -y]: negating y keeps the plan the right way round rather than mirrored.
 */
import type { Building, Level, Point, Room, RoomCategory } from "@wf/schema";

export type Vec3 = [number, number, number];

/** How far apart levels sit in the exploded view, in metres. */
export const EXPLODE_GAP_M = 12;

/** Thickness of a level's floor slab, and how tall room blocks stand on it. */
export const SLAB_THICKNESS = 0.35;
export const ROOM_HEIGHT = 1.6;

export interface LevelPlacement {
  levelId: string;
  /** Height of this level's floor in the scene. */
  y: number;
}

export function levelHeights(building: Building, levels: Level[], view: "exploded" | "solid"): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = [...levels].sort((a, b) => a.sortIndex - b.sortIndex);
  const base = sorted[0]?.elevationM ?? 0;
  sorted.forEach((level, index) => {
    out.set(level.id, view === "exploded" ? index * EXPLODE_GAP_M : level.elevationM - base);
  });
  return out;
}

export function toScene([x, y]: Point, height: number): Vec3 {
  return [x, height, -y];
}

/**
 * Plan (x, y) -> the 2D point handed to THREE.Shape, before `geometry.rotateX(-PI/2)`.
 * Written next to `shapeToScene` on purpose: these two and `toScene` must agree, or the extruded
 * meshes end up mirrored against the labels and the route, which is exactly what used to happen.
 */
export function planToShape([x, y]: Point): [number, number] {
  return [x, y];
}

/** Where a shape point lands after `rotateX(-PI/2)`, which maps (X, Y, Z) -> (X, Z, -Y). */
export function shapeToScene([sx, sy]: [number, number], height: number): Vec3 {
  return [sx, height, -sy];
}

/** Bounding box of a set of scene points, plus its centre and radius, for fitting the camera. */
export function boundsOf(points: Vec3[]): { center: Vec3; radius: number; min: Vec3; max: Vec3 } {
  if (!points.length) return { center: [0, 0, 0], radius: 1, min: [0, 0, 0], max: [0, 0, 0] };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]!);
      max[i] = Math.max(max[i]!, p[i]!);
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  return { center, radius, min, max };
}

/** Where to put the camera so `radius` fits in view, looking down from the south-ish. */
export function cameraFor(center: Vec3, radius: number, fovDegrees = 45, aspect = 1): Vec3 {
  const fov = (fovDegrees * Math.PI) / 180;
  const vertical = radius / Math.sin(fov / 2);
  const horizontal = radius / Math.sin(Math.atan(Math.tan(fov / 2) * Math.max(0.35, aspect)));
  const distance = Math.max(vertical, horizontal) * 1.1;
  // A three-quarter view: up and to one side, so levels read as stacked slabs.
  return [center[0] + distance * 0.55, center[1] + distance * 0.62, center[2] + distance * 0.55];
}

/** Placard colours, muted for large areas. */
export const CATEGORY_COLOR: Record<RoomCategory, string> = {
  classroom: "#8a9a5b",
  "computer-lab": "#7f9bb5",
  seminar: "#7f9bb5",
  library: "#9aab6a",
  office: "#7d5d7a",
  restroom: "#3b5bA9",
  lactation: "#c06a6a",
  auditorium: "#6f9fc4",
  stair: "#4f9d69",
  elevator: "#e0a458",
  service: "#9c9c9c",
  other: "#a0a0a0",
};

export const ROUTE_COLOR = "#c4820e";

/** Human wording for a category when the placard legend gives us nothing better. */
export const CATEGORY_LABEL: Record<RoomCategory, string> = {
  classroom: "Classroom",
  "computer-lab": "Computer lab",
  seminar: "Seminar room",
  library: "Library",
  office: "Office",
  restroom: "Restroom",
  lactation: "Lactation room",
  auditorium: "Auditorium",
  stair: "Stairs",
  elevator: "Elevator",
  service: "Service",
  other: "Other",
};

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseHex(a));
  const lb = relativeLuminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const toHex = (rgb: [number, number, number]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/**
 * A deeper shade of the room's own colour, so the number reads as painted on the room.
 * Darkened further when the first attempt is too close to the block to be legible.
 */
export function labelColor(category: RoomCategory): string {
  const block = CATEGORY_COLOR[category] ?? CATEGORY_COLOR.other;
  const rgb = parseHex(block);
  for (const factor of [0.42, 0.3, 0.2, 0.12]) {
    const candidate = toHex([rgb[0] * factor, rgb[1] * factor, rgb[2] * factor]);
    if (contrastRatio(candidate, block) >= 3) return candidate;
  }
  return "#12161c";
}

export interface LegendEntry {
  category: RoomCategory;
  color: string;
  label: string;
}

/** Fixed display order, so the key does not reshuffle between levels. */
const LEGEND_ORDER: RoomCategory[] = [
  "classroom",
  "auditorium",
  "seminar",
  "computer-lab",
  "library",
  "office",
  "restroom",
  "lactation",
  "stair",
  "elevator",
  "other",
];

/**
 * The categories actually present, labelled with the placard's own wording where there is one
 * (rooms carry the legend label they were coloured from in `group`).
 */
export function legendEntries(levels: Level[], focusLevel: string | null = null): LegendEntry[] {
  const shown = focusLevel ? levels.filter((l) => l.id === focusLevel) : levels;
  const groups = new Map<RoomCategory, Map<string, number>>();
  for (const level of shown) {
    for (const room of level.rooms as Room[]) {
      if (room.category === "service") continue;
      const counts = groups.get(room.category) ?? new Map<string, number>();
      if (room.group) counts.set(room.group, (counts.get(room.group) ?? 0) + 1);
      groups.set(room.category, counts);
    }
  }
  return LEGEND_ORDER.filter((category) => groups.has(category)).map((category) => {
    const counts = groups.get(category)!;
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { category, color: CATEGORY_COLOR[category], label: common?.[0] ?? CATEGORY_LABEL[category] };
  });
}

/** @deprecated Route geometry now follows the corridor polylines; see lib/route-geometry.ts. */
export function routePoints(nodes: { x: number; y: number; levelId: string }[], heights: Map<string, number>): Vec3[] {
  return nodes.map((n) => toScene([n.x, n.y], (heights.get(n.levelId) ?? 0) + 0.6));
}

export interface LevelVisibilityInput {
  levelIds: string[];
  /** Level id to its position in the stack, bottom first. */
  order: Map<string, number>;
  focusLevel: string | null;
  /** Levels the current route touches. */
  routeLevels: string[];
  /** The level the guide is currently walking on, if it is running. */
  walkingLevel: string | null;
  /** The user asked to see every level, which outranks everything the route would otherwise do. */
  showAll: boolean;
  view: "exploded" | "solid";
}

export interface LevelVisibility {
  dimmed: Set<string>;
  hidden: Set<string>;
  labelled: Set<string>;
}

/**
 * Which levels are lit, cut away or labelled.
 *
 * With a route showing, levels the route never touches dim, and in solid view everything above the
 * route is cut away so the path can be seen. "Show all" has to undo both: it used to clear only the
 * focus, so the route's own dimming came straight back and the button appeared to light just the
 * middle three levels.
 */
export function levelVisibility(i: LevelVisibilityInput): LevelVisibility {
  const dimmed = new Set<string>();
  const hidden = new Set<string>();
  // Room numbers from every level at once pile into an unreadable mess, so labels only go on the levels
  // being looked at, even when everything is lit.
  const labelled = new Set(i.focusLevel ? [i.focusLevel] : i.routeLevels);

  if (i.showAll && !i.focusLevel) return { dimmed, hidden, labelled };

  for (const id of i.levelIds) {
    if (i.focusLevel) {
      if (id !== i.focusLevel) dimmed.add(id);
    } else if (i.routeLevels.length && !i.routeLevels.includes(id)) dimmed.add(id);
  }

  if (i.view === "solid") {
    const topOfRoute = i.routeLevels.length ? Math.max(...i.routeLevels.map((id) => i.order.get(id) ?? 0)) : null;
    const cutAbove = i.focusLevel
      ? (i.order.get(i.focusLevel) ?? null)
      : i.walkingLevel
        ? (i.order.get(i.walkingLevel) ?? null)
        : topOfRoute;
    if (cutAbove !== null) for (const id of i.levelIds) if ((i.order.get(id) ?? 0) > cutAbove) hidden.add(id);
  }
  return { dimmed, hidden, labelled };
}
