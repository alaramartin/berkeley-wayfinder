import type { Point } from "@wf/schema";

export function area(poly: Point[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
  return Math.abs(s) / 2;
}

export function centroid(poly: Point[]): Point {
  const n = poly.length;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

export function contains(poly: Point[], [x, y]: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Keep the part of a polygon on the side of line a->b where the cross product has sign `sign` (Sutherland–Hodgman). */
function clip(poly: Point[], a: Point, b: Point, sign: 1 | -1): Point[] {
  const side = (p: Point) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    const sc = side(cur);
    const sp = side(prev);
    if (sc >= 0) {
      if (sp < 0) out.push(intersect(prev, cur, sp, sc));
      out.push(cur);
    } else if (sp >= 0) {
      out.push(intersect(prev, cur, sp, sc));
    }
  }
  return out;
}

function intersect(p: Point, q: Point, sp: number, sq: number): Point {
  const f = sp / (sp - sq);
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
}

/** Split a room polygon along the infinite line through a and b. Returns null if the line doesn't cut it. */
export function splitPolygon(poly: Point[], a: Point, b: Point, minFraction = 0.02): [Point[], Point[]] | null {
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return null;
  const left = clip(poly, a, b, 1);
  const right = clip(poly, a, b, -1);
  const total = area(poly);
  if (left.length < 3 || right.length < 3) return null;
  if (area(left) < minFraction * total || area(right) < minFraction * total) return null;
  return [left, right];
}
