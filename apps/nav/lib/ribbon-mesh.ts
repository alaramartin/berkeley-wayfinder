/**
 * Ribbon geometry: a flat strip of constant width along a path, with a bevel at sharp corners.
 *
 * Pure arrays rather than three.js buffers, so the shape can be unit-tested. The previous version
 * offset along a central difference and let a miter grow to 3x the width, which turned every sharp
 * corner into a carpet; here the offset follows the corner bisector and anything past a modest miter
 * limit is bevelled instead.
 */
import type { Vec3 } from "./scene";

export const RIBBON_WIDTH_M = 0.8;
/** One chevron per this many metres along the ribbon. */
export const ARROW_PERIOD_M = 1.4;
/** Past this much widening a corner is bevelled rather than mitered. */
const MITER_LIMIT = 1.6;

export interface RibbonMesh {
  /** xyz per vertex, left and right edge alternating. */
  positions: number[];
  /** u along the path (in chevron periods), v across it. */
  uvs: number[];
  /** rgba per vertex; alpha carries the distance fade. */
  colors: number[];
  indices: number[];
  /** Distance along the path at each vertex pair, for the fade. */
  vertexDistances: number[];
}

type Vec2 = [number, number];

const sub = (a: Vec3, b: Vec3): Vec2 => [a[0] - b[0], a[2] - b[2]];
const norm = ([x, z]: Vec2): Vec2 => {
  const length = Math.hypot(x, z);
  return length < 1e-6 ? [1, 0] : [x / length, z / length];
};
/** Left-hand normal of a direction in the XZ plane. */
const leftOf = ([x, z]: Vec2): Vec2 => [-z, x];

export function buildRibbonMesh(points: Vec3[], distances: number[], width = RIBBON_WIDTH_M): RibbonMesh {
  const mesh: RibbonMesh = { positions: [], uvs: [], colors: [], indices: [], vertexDistances: [] };
  if (points.length < 2) return mesh;
  const half = width / 2;

  const emit = (at: Vec3, offset: Vec2, distance: number) => {
    const u = distance / ARROW_PERIOD_M;
    mesh.positions.push(at[0] + offset[0], at[1], at[2] + offset[1], at[0] - offset[0], at[1], at[2] - offset[1]);
    mesh.uvs.push(u, 0, u, 1);
    mesh.colors.push(1, 1, 1, 1, 1, 1, 1, 1);
    mesh.vertexDistances.push(distance, distance);
  };

  for (let i = 0; i < points.length; i++) {
    const here = points[i]!;
    const distance = distances[i] ?? 0;
    const incoming = i > 0 ? norm(sub(here, points[i - 1]!)) : null;
    const outgoing = i < points.length - 1 ? norm(sub(points[i + 1]!, here)) : null;

    // The ends have a single segment, so they use its own normal and come out exactly `width` wide.
    if (!incoming || !outgoing) {
      const direction = (incoming ?? outgoing)!;
      const n = leftOf(direction);
      emit(here, [n[0] * half, n[1] * half], distance);
      continue;
    }

    const cosHalf = Math.sqrt(Math.max(0, (1 + (incoming[0] * outgoing[0] + incoming[1] * outgoing[1])) / 2));
    const bisector = norm([incoming[0] + outgoing[0], incoming[1] + outgoing[1]]);
    const n = leftOf(bisector);

    if (cosHalf > 1e-3 && 1 / cosHalf <= MITER_LIMIT) {
      // Gentle corner: one mitered pair keeps the width constant across the join.
      const scale = half / cosHalf;
      emit(here, [n[0] * scale, n[1] * scale], distance);
      continue;
    }

    // Sharp corner: two square-ended pairs, one per segment, joined by the strip itself.
    const nIn = leftOf(incoming);
    const nOut = leftOf(outgoing);
    emit(here, [nIn[0] * half, nIn[1] * half], distance);
    emit(here, [nOut[0] * half, nOut[1] * half], distance);
  }

  const pairs = mesh.positions.length / 6;
  for (let i = 1; i < pairs; i++) {
    const a = (i - 1) * 2;
    mesh.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return mesh;
}

/** The drawn width at each vertex pair, for tests: a ribbon should stay near its nominal width. */
export function ribbonWidths(mesh: RibbonMesh): number[] {
  const out: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 6) {
    const dx = mesh.positions[i]! - mesh.positions[i + 3]!;
    const dz = mesh.positions[i + 2]! - mesh.positions[i + 5]!;
    out.push(Math.hypot(dx, dz));
  }
  return out;
}
