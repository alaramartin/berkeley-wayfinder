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
