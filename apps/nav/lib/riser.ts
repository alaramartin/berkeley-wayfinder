/**
 * The arrows that flow along a riser between two floors.
 *
 * Everything is in the riser's own frame, where +y always points from the departure end to the arrival
 * end — the group is rotated onto the shaft, so "the way you are going" is +y whether the route climbs
 * or descends. Working in that frame is what keeps the arrows honest: an earlier version also flipped
 * the cones and reversed the slide when descending, which turned both back the wrong way.
 */

/** Metres per second the arrows travel. */
export const ARROW_SPEED_MPS = 1.6;
/** Fraction of the riser, at each end, over which an arrow fades and shrinks in or out. */
export const ARROW_FADE_FRACTION = 0.16;

export interface RiserArrow {
  /** Position along the riser, from -length/2 (departure) to +length/2 (arrival). */
  y: number;
  /** 0 when an arrow is entering or leaving, 1 in the middle. Drives both scale and opacity. */
  fade: number;
}

const smoothstep = (edge: number, x: number) => {
  const t = Math.min(1, Math.max(0, x / edge));
  return t * t * (3 - 2 * t);
};

/** `phase` is in [0, 1) and advances with time; arrows are spread evenly and wrap around. */
export function riserArrows(phase: number, count: number, length: number): RiserArrow[] {
  const out: RiserArrow[] = [];
  for (let i = 0; i < count; i++) {
    // Wrapping happens where the arrow is invisible, so there is no pop as it goes round.
    const t = (((phase + i / count) % 1) + 1) % 1;
    const fade = smoothstep(ARROW_FADE_FRACTION, t) * smoothstep(ARROW_FADE_FRACTION, 1 - t);
    out.push({ y: -length / 2 + t * length, fade });
  }
  return out;
}

/** How far the phase moves in `deltaSeconds`, so the speed is the same whatever the riser's length. */
export function advancePhase(phase: number, deltaSeconds: number, length: number): number {
  if (length <= 0) return phase;
  return (phase + (deltaSeconds * ARROW_SPEED_MPS) / length) % 1;
}
