/**
 * Where a door sits on a corridor, in the building's metres (x east, y north).
 *
 * `t` is the fraction of the corridor's length along its polyline. `side` is which side of the
 * corridor, walking from its first node to its last, the room is on: left when the cross product is
 * positive (checked against Wheeler's accepted data, where 201 of 202 doors agree).
 */
import type { Point } from "@wf/schema";

const dist = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polylineLength(pl: Point[]): number {
  let total = 0;
  for (let i = 0; i < pl.length - 1; i++) total += dist(pl[i]!, pl[i + 1]!);
  return total;
}

/** The point a fraction `t` of the way along the polyline, and the direction of travel there. */
export function pointAlong(pl: Point[], t: number): { point: Point; direction: Point } {
  const total = polylineLength(pl);
  let want = Math.min(1, Math.max(0, t)) * total;
  for (let i = 0; i < pl.length - 1; i++) {
    const a = pl[i]!;
    const b = pl[i + 1]!;
    const len = dist(a, b);
    if (want <= len || i === pl.length - 2) {
      const f = len ? Math.min(1, want / len) : 0;
      const direction: Point = len ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [1, 0];
      return { point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], direction };
    }
    want -= len;
  }
  return { point: pl[0] ?? [0, 0], direction: [1, 0] };
}

export interface Projection {
  t: number;
  point: Point;
  distance: number;
  side: "left" | "right";
}

/** The nearest point on a polyline to `p`: where along it, how far away, and which side `p` is on. */
export function projectOnPolyline(pl: Point[], p: Point): Projection {
  const total = polylineLength(pl) || 1;
  let walked = 0;
  let best: Projection = { t: 0, point: pl[0] ?? [0, 0], distance: Infinity, side: "left" };
  for (let i = 0; i < pl.length - 1; i++) {
    const a = pl[i]!;
    const b = pl[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1e-12;
    const f = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    const q: Point = [a[0] + dx * f, a[1] + dy * f];
    const d = dist(p, q);
    if (d < best.distance) {
      const cross = dx * (p[1] - q[1]) - dy * (p[0] - q[0]);
      best = { t: (walked + Math.sqrt(len2) * f) / total, point: q, distance: d, side: cross > 0 ? "left" : "right" };
    }
    walked += Math.sqrt(len2);
  }
  return best;
}

/** Where to draw a door: on the corridor, nudged a little into the room's side so it reads as a door. */
export function doorMarker(pl: Point[], t: number, side: "left" | "right", nudgeM = 0.5): Point {
  const { point, direction } = pointAlong(pl, t);
  const sign = side === "left" ? 1 : -1;
  return [point[0] + -direction[1] * sign * nudgeM, point[1] + direction[0] * sign * nudgeM];
}

/** Whether `p` is inside a polygon (even-odd). */
export function inPolygon(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
