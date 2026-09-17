import type { Point, Similarity } from "@wf/schema";

export const IDENTITY: Similarity = { scale: 1, rotation: 0, tx: 0, ty: 0 };

export function apply(t: Similarity, [x, y]: Point): Point {
  const c = Math.cos(t.rotation) * t.scale;
  const s = Math.sin(t.rotation) * t.scale;
  return [c * x - s * y + t.tx, s * x + c * y + t.ty];
}

export function invert(t: Similarity): Similarity {
  const scale = 1 / t.scale;
  const rotation = -t.rotation;
  const [tx, ty] = apply({ scale, rotation, tx: 0, ty: 0 }, [-t.tx, -t.ty]);
  return { scale, rotation, tx, ty };
}

/** a then b. */
export function compose(a: Similarity, b: Similarity): Similarity {
  const [tx, ty] = apply(b, [a.tx, a.ty]);
  return { scale: a.scale * b.scale, rotation: a.rotation + b.rotation, tx, ty };
}

export interface SimilarityFit {
  transform: Similarity;
  /** Per-pair distance between apply(transform, src[i]) and dst[i]. */
  residuals: number[];
  rms: number;
}

/**
 * Least-squares similarity (Umeyama, no reflection) mapping src -> dst.
 * Needs >= 2 non-coincident pairs. Used for level-to-level anchors and the OSM footprint fit.
 */
export function fitSimilarity(src: Point[], dst: Point[]): SimilarityFit {
  if (src.length !== dst.length) throw new Error("fitSimilarity: src/dst length mismatch");
  if (src.length < 2) throw new Error("fitSimilarity: need at least 2 point pairs");
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i]![0]; sy += src[i]![1];
    dx += dst[i]![0]; dy += dst[i]![1];
  }
  sx /= n; sy /= n; dx /= n; dy /= n;

  // For 2D, the optimal rotation/scale come from a = sum(s·d), b = sum(s×d) over centered points.
  let a = 0, b = 0, srcVar = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i]![0] - sx, py = src[i]![1] - sy;
    const qx = dst[i]![0] - dx, qy = dst[i]![1] - dy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    srcVar += px * px + py * py;
  }
  if (srcVar === 0) throw new Error("fitSimilarity: source points are coincident");
  const rotation = Math.atan2(b, a);
  const scale = Math.hypot(a, b) / srcVar;
  const [rx, ry] = apply({ scale, rotation, tx: 0, ty: 0 }, [sx, sy]);
  const transform = { scale, rotation, tx: dx - rx, ty: dy - ry };

  const residuals = src.map((p, i) => distance(apply(transform, p), dst[i]!));
  const rms = Math.sqrt(residuals.reduce((acc, r) => acc + r * r, 0) / n);
  return { transform, residuals, rms };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Image coordinates have y pointing down; the building frame has y pointing up. A similarity that operates in
 * image coordinates, expressed on y-flipped coordinates: F∘t∘F where F(x, y) = (x, -y).
 */
export function flipSimilarity(t: Similarity): Similarity {
  return { scale: t.scale, rotation: -t.rotation, tx: t.tx, ty: -t.ty };
}

/** Apply a level's imageTransform (defined on (x, -y) of image pixels) to an image point. */
export function imageToWorld(t: Similarity, [x, y]: Point): Point {
  return apply(t, [x, -y]);
}

export function worldToImage(t: Similarity, p: Point): Point {
  const [x, y] = apply(invert(t), p);
  return [x, -y];
}

/**
 * imageTransform for a level: first align its pixels to the reference level (image-space similarity),
 * then map reference pixels to world meters (similarity on flipped reference pixels).
 */
export function levelImageTransform(toReference: Similarity, referenceToWorld: Similarity): Similarity {
  return compose(flipSimilarity(toReference), referenceToWorld);
}
