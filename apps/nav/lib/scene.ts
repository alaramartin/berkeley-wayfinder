/**
 * Turning level data into scene numbers. Pure maths, so it can be tested without a canvas.
 *
 * Building-local metres are x east, y north, z up. Three.js is y up, so a point (x, y) on level L
 * becomes [x, height(L), -y]: negating y keeps the plan the right way round rather than mirrored.
 */
import type { Building, Level, Point } from "@wf/schema";

export type Vec3 = [number, number, number];

/** How far apart levels sit in the exploded view, in metres. */
export const EXPLODE_GAP_M = 12;

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
export const CATEGORY_COLOR: Record<string, string> = {
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

/** Points of a route's node list in scene space, using the current level heights. */
export function routePoints(nodes: { x: number; y: number; levelId: string }[], heights: Map<string, number>): Vec3[] {
  return nodes.map((n) => toScene([n.x, n.y], (heights.get(n.levelId) ?? 0) + 0.6));
}
