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

/**
 * What a drag should turn about.
 *
 * Zoomed out, that is the middle of the building: it spins on the spot like a model on a turntable.
 * Zoomed into a corridor the building's centre can be tens of metres away and off to one side, and
 * turning about it sweeps the camera off the route entirely — so the pivot slides up the view axis to
 * something you are actually looking at. Taking the building's centre *along the view direction*
 * gives both, with no jump between them.
 */
export function pivotFor(pose: Pose, modelCentre: Vec3, modelRadius: number): Vec3 {
  const forward = normalize([pose.target[0] - pose.eye[0], pose.target[1] - pose.eye[1], pose.target[2] - pose.eye[2]]);
  const toCentre: Vec3 = [modelCentre[0] - pose.eye[0], modelCentre[1] - pose.eye[1], modelCentre[2] - pose.eye[2]];
  const ahead = dot(toCentre, forward);
  const toTarget = Math.hypot(pose.target[0] - pose.eye[0], pose.target[1] - pose.eye[1], pose.target[2] - pose.eye[2]);
  // Never behind the camera, never further than the centre itself, and never so close that a small
  // drag spins the world around your nose.
  const distance = Math.min(Math.max(ahead, Math.min(toTarget, modelRadius * 0.25)), Math.hypot(toCentre[0], toCentre[1], toCentre[2]));
  return [pose.eye[0] + forward[0] * distance, pose.eye[1] + forward[1] * distance, pose.eye[2] + forward[2] * distance];
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
  /**
   * What the camera turns about: the middle of the building.
   *
   * Turning about the spot the user grabbed is geometrically honest but unusable — grab a corner and
   * a half-turn swings everything else off screen. Turning about whatever the view happens to be
   * centred on has the same problem one step removed, because that point is rarely the model's
   * middle. The building's own centre is the only pivot that keeps it on the turntable.
   */
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

  // How far to turn. The polar clamp is applied to the eye's angle about the pivot, and whatever it
  // allows is the rotation the whole camera gets.
  const { theta, phi } = toSpherical(grab.pose.eye, grab.pivot);
  // Dragging the full width of the view turns the model half a turn, and the full height covers the
  // whole range of tilt once. A full turn per width felt twitchy.
  const turned = theta - (dx / Math.max(1, grab.viewport.width)) * Math.PI;
  const tipped = clampPolar(phi - (dy / Math.max(1, grab.viewport.height)) * (Math.PI / 2));
  const yaw = turned - theta;
  const pitch = tipped - phi;

  // Rotate the camera *and* what it is looking at, rigidly, about the grabbed point. Re-aiming at the
  // pivot instead would make the view jump the instant a drag began, however small the movement.
  const about = (p: Vec3, axis: Vec3, angle: number): Vec3 => {
    const v: Vec3 = [p[0] - grab.pivot[0], p[1] - grab.pivot[1], p[2] - grab.pivot[2]];
    const r = rotateAbout(v, axis, angle);
    return [grab.pivot[0] + r[0], grab.pivot[1] + r[1], grab.pivot[2] + r[2]];
  };

  const yawedEye = about(grab.pose.eye, [0, 1, 0], yaw);
  const yawedTarget = about(grab.pose.target, [0, 1, 0], yaw);
  // Tilt about the camera's own horizontal axis, so dragging up and down tips the model towards you.
  const forward = normalize([yawedTarget[0] - yawedEye[0], 0, yawedTarget[2] - yawedEye[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const eye = about(yawedEye, right, pitch);
  const target = about(yawedTarget, right, pitch);

  // No translation on top. A rigid rotation of the camera about the pivot already leaves the pivot at
  // exactly the same place on screen, so the building turns in place instead of wandering off-frame.
  return { eye, target };
}

/** Rodrigues rotation of a vector about a unit axis. */
function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  if (angle === 0) return v;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const d = dot(axis, v);
  const c = cross(axis, v);
  return [
    v[0] * cosA + c[0] * sinA + axis[0] * d * (1 - cosA),
    v[1] * cosA + c[1] * sinA + axis[1] * d * (1 - cosA),
    v[2] * cosA + c[2] * sinA + axis[2] * d * (1 - cosA),
  ];
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
