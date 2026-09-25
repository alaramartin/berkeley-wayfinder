/**
 * Camera poses. Pure maths so the framing can be tested without a canvas.
 *
 * The rule that matters: nothing here is applied as a side effect of derived state. Every move is an
 * explicit flight the user can interrupt, which is why zoom no longer snaps back to one fixed spot.
 */
import { type LevelRibbon, pointAtDistance } from "./route-geometry";
import { type Vec3, cameraFor } from "./scene";

export interface Pose {
  eye: Vec3;
  target: Vec3;
}

/** How far ahead the heading is averaged, so corridor wobble doesn't swing the camera. */
const LOOKAHEAD_M = 8;
const EYE_BEHIND_M = 12;
const EYE_ABOVE_M = 7.5;
const TARGET_AHEAD_M = 12;
const TARGET_ABOVE_M = 1.2;

export function overviewPose(center: Vec3, radius: number, aspect: number): Pose {
  return { eye: cameraFor(center, radius, 45, aspect), target: center };
}

/**
 * A low three-quarter view sitting behind the walker, looking along the way they are about to go.
 * `levelY` lifts the pose onto the level's current height (levels move when the view toggles).
 */
export function stepPose(ribbon: LevelRibbon, pointIndex: number, levelY: number, ceilingY?: number): Pose {
  const here = ribbon.points[Math.min(pointIndex, ribbon.points.length - 1)] ?? [0, 0, 0];
  const distance = ribbon.distances[Math.min(pointIndex, ribbon.distances.length - 1)] ?? 0;
  const ahead = pointAtDistance(ribbon, distance + LOOKAHEAD_M);
  const back = pointAtDistance(ribbon, Math.max(0, distance - LOOKAHEAD_M));

  let dx = ahead[0] - back[0];
  let dz = ahead[2] - back[2];
  const length = Math.hypot(dx, dz);
  if (length < 0.1) {
    dx = 1;
    dz = 0;
  } else {
    dx /= length;
    dz /= length;
  }

  // In solid view the floor above is a real ceiling: an eye above it looks at the inside of a slab.
  const eyeY = ceilingY === undefined ? levelY + EYE_ABOVE_M : Math.min(levelY + EYE_ABOVE_M, ceilingY);
  return {
    eye: [here[0] - dx * EYE_BEHIND_M, eyeY, here[2] - dz * EYE_BEHIND_M],
    target: [here[0] + dx * TARGET_AHEAD_M, levelY + TARGET_ABOVE_M, here[2] + dz * TARGET_AHEAD_M],
  };
}

export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

export function lerpPose(from: Pose, to: Pose, t: number): Pose {
  const e = easeInOutCubic(t);
  const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
  return { eye: mix(from.eye, to.eye), target: mix(from.target, to.target) };
}
