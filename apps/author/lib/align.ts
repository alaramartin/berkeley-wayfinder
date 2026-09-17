/** Alignment helpers: similarity from anchor pairs, and outline-based auto-alignment (ICP over 4 quarter turns). */
import { apply, compose, fitSimilarity } from "@wf/geometry";
import type { AnchorPair, Point, Similarity } from "@wf/schema";
import { area, centroid } from "./polygon";

export function fromAnchors(anchors: AnchorPair[]): { transform: Similarity; rms: number } | null {
  if (anchors.length < 2) return null;
  try {
    const fit = fitSimilarity(anchors.map((a) => a.src), anchors.map((a) => a.dst));
    return { transform: fit.transform, rms: fit.rms };
  } catch {
    return null;
  }
}

export function residuals(anchors: AnchorPair[], t: Similarity): number[] {
  return anchors.map((a) => {
    const q = apply(t, a.src);
    return Math.hypot(q[0] - a.dst[0], q[1] - a.dst[1]);
  });
}

/** Evenly spaced points along a closed polygon's boundary. */
export function sampleBoundary(poly: Point[], n: number): Point[] {
  const segs = poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as const);
  const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  const total = lens.reduce((s, l) => s + l, 0);
  const out: Point[] = [];
  let seg = 0;
  let walked = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    while (seg < segs.length - 1 && walked + lens[seg]! < target) walked += lens[seg++]!;
    const [a, b] = segs[seg]!;
    const f = lens[seg]! === 0 ? 0 : (target - walked) / lens[seg]!;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

function nearest(points: Point[], q: Point): Point {
  let best = points[0]!;
  let bestD = Infinity;
  for (const p of points) {
    const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d < bestD) [bestD, best] = [d, p];
  }
  return best;
}

export interface AutoAlignResult {
  transform: Similarity;
  /** Mean distance from transformed source samples to the nearest target sample (target units). */
  error: number;
  rotationDeg: number;
  /** Every quarter-turn start's result, best first. Near-symmetric buildings can have close runners-up. */
  candidates: { transform: Similarity; error: number; rotationDeg: number }[];
}

/**
 * Align `src` outline onto `dst` outline. Tries 0/90/180/270° starts (placards aren't all drawn the same way up),
 * scale from the area ratio, then ICP. Works for full floors; partial floors (mezzanines) need anchors.
 */
export function autoAlign(src: Point[], dst: Point[], iterations = 30): AutoAlignResult {
  const S = sampleBoundary(src, 240);
  const D = sampleBoundary(dst, 480);
  const [scx, scy] = centroid(S);
  const [dcx, dcy] = centroid(D);
  const scale = Math.sqrt(area(dst) / Math.max(area(src), 1e-9));
  const candidates: AutoAlignResult["candidates"] = [];
  for (const deg of [0, 90, 180, 270]) {
    const rot = (deg * Math.PI) / 180;
    // Start: rotate+scale about the source centroid, then move onto the target centroid.
    const center: Similarity = { scale: 1, rotation: 0, tx: -scx, ty: -scy };
    let t = compose(center, { scale, rotation: rot, tx: dcx, ty: dcy });
    for (let it = 0; it < iterations; it++) {
      const moved = S.map((p) => apply(t, p));
      const matches = moved.map((q) => nearest(D, q));
      // Refit using the original source points against their current matches.
      const fit = fitSimilarity(S, matches);
      t = fit.transform;
    }
    const moved = S.map((p) => apply(t, p));
    const error = moved.reduce((s, q) => {
      const n = nearest(D, q);
      return s + Math.hypot(n[0] - q[0], n[1] - q[1]);
    }, 0) / moved.length;
    candidates.push({ transform: t, error, rotationDeg: deg });
  }
  candidates.sort((a, b) => a.error - b.error);
  return { ...candidates[0]!, candidates };
}

/** SVG matrix() for a similarity in the same (non-flipped) coordinate system. */
export function svgMatrix(t: Similarity): string {
  const a = t.scale * Math.cos(t.rotation);
  const b = t.scale * Math.sin(t.rotation);
  return `matrix(${a} ${b} ${-b} ${a} ${t.tx} ${t.ty})`;
}

/** Rotate an existing transform by a quarter turn about a point (in target coordinates). */
export function rotateAbout(t: Similarity, degrees: number, about: Point): Similarity {
  const r = (degrees * Math.PI) / 180;
  const toOrigin: Similarity = { scale: 1, rotation: 0, tx: -about[0], ty: -about[1] };
  const back: Similarity = { scale: 1, rotation: r, tx: about[0], ty: about[1] };
  return compose(compose(t, toOrigin), back);
}
