/**
 * Real floor heights from the walk.
 *
 * A stairwell's step count between two floors, times the height of one step, is the height between
 * them. Counts from every stairwell that joins the same two neighbouring levels are combined by median,
 * so one miscounted flight does not move a floor. Levels with no count keep the distance they had to the
 * level above (the default guess), and the stack is re-stacked bottom to top so the elevations stay consistent.
 *
 * A stairwell that skips a level (Wheeler's basement-to-ground flights pass the mezzanine) says nothing
 * about the levels in between on its own, so it is reported instead of guessed at.
 */
import type { ShaftLike } from "./apply";

export const STEP_RISE_M = 0.17;

export interface LevelHeight {
  id: string;
  sortIndex: number;
  elevationM: number;
  heightM: number;
  heightSource: "default" | "stair-count" | "measured";
}

export interface ElevationResult {
  levels: LevelHeight[];
  /** One line per thing worth the user's attention. */
  notes: string[];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export function deriveElevations(levels: LevelHeight[], shafts: ShaftLike[], levelOfNode: (nodeId: string) => string | undefined, riseM = STEP_RISE_M): ElevationResult {
  const ordered = [...levels].sort((a, b) => a.sortIndex - b.sortIndex);
  const index = new Map(ordered.map((l, i) => [l.id, i]));
  const gaps = new Map<number, number[]>();
  const notes: string[] = [];

  for (const shaft of shafts) {
    // Only stairs have steps; a lift's counts, if any, say nothing about floor height.
    if (!shaft.stepCounts || (shaft.kind && shaft.kind !== "stair")) continue;
    shaft.stepCounts.forEach((steps, i) => {
      if (steps === null || steps === undefined) return;
      const lower = index.get(levelOfNode(shaft.nodeIds[i]!) ?? "");
      const upper = index.get(levelOfNode(shaft.nodeIds[i + 1]!) ?? "");
      if (lower === undefined || upper === undefined) return;
      if (upper === lower + 1) {
        const list = gaps.get(lower) ?? [];
        list.push(steps * riseM);
        gaps.set(lower, list);
      } else if (upper > lower + 1) {
        notes.push(`${shaft.id} flight ${i + 1} (${steps} steps) skips ${upper - lower - 1} level(s), so it fixes no single floor on its own`);
      }
    });
  }

  const out = ordered.map((l) => ({ ...l }));
  // The distance to the level above, measured where there is a count and otherwise what it already
  // was. Not `heightM`: that is a floor-to-floor default, and a mezzanine sits half a floor up, so
  // re-stacking from it would shove everything above the mezzanine up by the difference.
  const gapAbove = ordered.map((l, i) => {
    const measured = gaps.get(i);
    const next = ordered[i + 1];
    return measured?.length ? Math.round(median(measured) * 100) / 100 : next ? next.elevationM - l.elevationM : l.heightM;
  });
  for (let i = 0; i < out.length; i++) {
    const level = out[i]!;
    const measured = gaps.get(i);
    if (measured?.length) {
      level.heightM = gapAbove[i]!;
      level.heightSource = "stair-count";
      if (measured.length > 1) {
        const spread = Math.max(...measured) - Math.min(...measured);
        if (spread > 0.5) notes.push(`Level ${level.id}: stairwells disagree by ${spread.toFixed(1)} m, using the median`);
      }
    }
    const above = out[i + 1];
    if (above) above.elevationM = Math.round((level.elevationM + gapAbove[i]!) * 100) / 100;
  }
  return { levels: out, notes };
}
