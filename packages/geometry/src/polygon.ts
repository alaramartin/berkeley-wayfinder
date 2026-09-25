import type { Point } from "@wf/schema";

/** Signed shoelace area; positive for counter-clockwise rings (y up). */
export function signedArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
  }
  return s / 2;
}

export function area(poly: Point[]): number {
  return Math.abs(signedArea(poly));
}

export function centroid(poly: Point[]): Point {
  const a = signedArea(poly);
  if (a === 0) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
    cx += (poly[j]![0] + poly[i]![0]) * f;
    cy += (poly[j]![1] + poly[i]![1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Ray casting. Points exactly on the boundary may go either way. */
export function pointInPolygon([x, y]: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's nearest edge; negative outside. */
function signedDistanceToEdges([x, y]: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!;
    const [bx, by] = poly[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return pointInPolygon([x, y], poly) ? best : -best;
}

/**
 * A point guaranteed to be inside the polygon, for labels and route endpoints.
 * The area centroid when that lands inside; otherwise the point furthest from any edge
 * (pole of inaccessibility), found by sampling the bounding box and refining locally.
 */
export function interiorPoint(poly: Point[]): Point {
  if (poly.length < 3) return centroid(poly);
  const c = centroid(poly);
  if (pointInPolygon(c, poly)) return c;

  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  let best: Point = c;
  let bestDistance = -Infinity;
  const search = (x0: number, y0: number, x1: number, y1: number, steps: number) => {
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const p: Point = [x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * j) / steps];
        const d = signedDistanceToEdges(p, poly);
        if (d > bestDistance) {
          bestDistance = d;
          best = p;
        }
      }
    }
  };
  search(minX, minY, maxX, maxY, 16);
  // Two rounds of local refinement around the winner.
  for (const fraction of [4, 16]) {
    const rx = (maxX - minX) / fraction;
    const ry = (maxY - minY) / fraction;
    search(best[0] - rx, best[1] - ry, best[0] + rx, best[1] + ry, 8);
  }
  return best;
}

/** Width and length of a polygon measured along an axis rotated by `angle`, for fitting text into it. */
export function orientedExtent(poly: Point[], angle: number): { along: number; across: number } {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, y] of poly) {
    const u = x * cos - y * sin;
    const v = x * sin + y * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { along: maxU - minU, across: maxV - minV };
}

export function polylineLength(line: Point[]): number {
  let len = 0;
  for (let i = 1; i < line.length; i++) len += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  return len;
}

/** Point at fraction t (0..1) of a polyline's length. */
export function pointAlong(line: Point[], t: number): Point {
  const target = Math.min(Math.max(t, 0), 1) * polylineLength(line);
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!;
    const [bx, by] = line[i]!;
    const seg = Math.hypot(bx - ax, by - ay);
    if (walked + seg >= target && seg > 0) {
      const f = (target - walked) / seg;
      return [ax + (bx - ax) * f, ay + (by - ay) * f];
    }
    walked += seg;
  }
  return line[line.length - 1]!;
}
