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

/** State captured when a grab starts, so a long drag never accumulates drift. */
export interface Grab {
  pose: Pose;
  /** The world point under the cursor when the drag began; the camera turns about this. */
  pivot: Vec3;
  cursor: { x: number; y: number };
  viewport: { width: number; height: number };
  fovDegrees: number;
}

const clampPolar = (phi: number) => Math.min(Math.PI / 2.05, Math.max(0.12, phi));

function toSpherical(eye: Vec3, pivot: Vec3): { radius: number; theta: number; phi: number } {
  const [x, y, z] = [eye[0] - pivot[0], eye[1] - pivot[1], eye[2] - pivot[2]];
  const radius = Math.hypot(x, y, z) || 1e-6;
  return { radius, theta: Math.atan2(x, z), phi: Math.acos(Math.min(1, Math.max(-1, y / radius))) };
}

function fromSpherical(pivot: Vec3, radius: number, theta: number, phi: number): Vec3 {
  const sinPhi = Math.sin(phi);
  return [pivot[0] + radius * sinPhi * Math.sin(theta), pivot[1] + radius * Math.cos(phi), pivot[2] + radius * sinPhi * Math.cos(theta)];
}

/** The world point under a screen position, on the plane through `depthAt` facing the camera. */
export function pointUnderCursor(pose: Pose, cursor: { x: number; y: number }, viewport: { width: number; height: number }, fovDegrees: number, depthAt: Vec3): Vec3 {
  const forward = normalize([pose.target[0] - pose.eye[0], pose.target[1] - pose.eye[1], pose.target[2] - pose.eye[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  // Distance along the view direction to the plane the grabbed point sits on.
  const toPoint: Vec3 = [depthAt[0] - pose.eye[0], depthAt[1] - pose.eye[1], depthAt[2] - pose.eye[2]];
  const depth = dot(toPoint, forward);
  const halfHeight = Math.tan((fovDegrees * Math.PI) / 360) * depth;
  const halfWidth = halfHeight * (viewport.width / Math.max(1, viewport.height));
  // Screen position in [-1, 1], y up.
  const nx = (cursor.x / Math.max(1, viewport.width)) * 2 - 1;
  const ny = 1 - (cursor.y / Math.max(1, viewport.height)) * 2;
  return [
    pose.eye[0] + forward[0] * depth + right[0] * nx * halfWidth + up[0] * ny * halfHeight,
    pose.eye[1] + forward[1] * depth + right[1] * nx * halfWidth + up[1] * ny * halfHeight,
    pose.eye[2] + forward[2] * depth + right[2] * nx * halfWidth + up[2] * ny * halfHeight,
  ];
}

/**
 * Turn the building about the point the user grabbed, keeping that point under the cursor.
 *
 * Rotation alone would slide the grabbed point away from the finger, which is what makes an orbit
 * control feel like it is fighting you; the second half of this shifts the camera so the point the
 * user is holding stays put.
 */
export function grabRotate(grab: Grab, cursor: { x: number; y: number }): Pose {
  // A flick can report a delta far outside the window; past a full drag across the viewport the
  // compensation below would fling the camera somewhere absurd.
  const dx = clamp(cursor.x - grab.cursor.x, grab.viewport.width);
  const dy = clamp(cursor.y - grab.cursor.y, grab.viewport.height);
  const { radius, theta, phi } = toSpherical(grab.pose.eye, grab.pivot);
  // A full width of drag turns the model half a turn; a full height tips it through its limits.
  const turned = theta - (dx / Math.max(1, grab.viewport.width)) * Math.PI * 2;
  const tipped = clampPolar(phi - (dy / Math.max(1, grab.viewport.height)) * Math.PI);

  const eye = fromSpherical(grab.pivot, radius, turned, tipped);
  const rotated: Pose = { eye, target: grab.pivot };

  // Put the grabbed point back under the cursor.
  const held = { x: grab.cursor.x + dx, y: grab.cursor.y + dy };
  const under = pointUnderCursor(rotated, held, grab.viewport, grab.fovDegrees, grab.pivot);
  const shift: Vec3 = [grab.pivot[0] - under[0], grab.pivot[1] - under[1], grab.pivot[2] - under[2]];
  return {
    eye: [eye[0] + shift[0], eye[1] + shift[1], eye[2] + shift[2]],
    target: [grab.pivot[0] + shift[0], grab.pivot[1] + shift[1], grab.pivot[2] + shift[2]],
  };
}

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Where a world point lands on screen, for checking that a grab kept its grip. */
export function projectToScreen(pose: Pose, point: Vec3, viewport: { width: number; height: number }, fovDegrees: number): { x: number; y: number } {
  const forward = normalize([pose.target[0] - pose.eye[0], pose.target[1] - pose.eye[1], pose.target[2] - pose.eye[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const toPoint: Vec3 = [point[0] - pose.eye[0], point[1] - pose.eye[1], point[2] - pose.eye[2]];
  const depth = dot(toPoint, forward) || 1e-6;
  const halfHeight = Math.tan((fovDegrees * Math.PI) / 360) * depth;
  const halfWidth = halfHeight * (viewport.width / Math.max(1, viewport.height));
  const nx = dot(toPoint, right) / halfWidth;
  const ny = dot(toPoint, up) / halfHeight;
  return { x: ((nx + 1) / 2) * viewport.width, y: ((1 - ny) / 2) * viewport.height };
}
