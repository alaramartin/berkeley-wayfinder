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

/** Never frame less than this much path, so a two-metre step still shows somewhere to look. */
const MIN_SPAN_M = 5;

/**
 * A low three-quarter view behind a step, looking along it, close enough that the whole stretch fills
 * the view. The heading is the step's own direction, so a turn in the instructions shows up as the
 * view actually turning; averaging the heading over several metres, as this once did, smeared every
 * turn away and made consecutive steps look the same.
 *
 * `levelY` lifts the pose onto the level's current height (levels move when the view toggles) and
 * `ceilingY` keeps the eye under the floor above in solid view.
 */
export function spanPose(ribbon: LevelRibbon, startDistance: number, endDistance: number, levelY: number, ceilingY?: number): Pose {
  const last = ribbon.distances[ribbon.distances.length - 1] ?? 0;
  const d0 = Math.min(last, Math.max(0, startDistance));
  let d1 = Math.min(last, Math.max(d0, endDistance));
  if (d1 - d0 < MIN_SPAN_M) d1 = Math.min(last, d0 + MIN_SPAN_M);
  // At the very end of a ribbon there may be nothing ahead, so look back instead.
  const from = d1 - d0 < 1 ? Math.max(0, d1 - MIN_SPAN_M) : d0;

  const a = pointAtDistance(ribbon, from);
  const b = pointAtDistance(ribbon, d1);
  let dx = b[0] - a[0];
  let dz = b[2] - a[2];
  const chord = Math.hypot(dx, dz);
  if (chord < 0.1) {
    dx = 1;
    dz = 0;
  } else {
    dx /= chord;
    dz /= chord;
  }

  const span = Math.max(d1 - from, MIN_SPAN_M);
  const middle: Vec3 = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
  // Far enough back that the whole step fits. A 40 m corridor needs the camera well out, so these
  // are generous: capping them at 24 m and 14 m left the start of a long step below the bottom edge.
  const behind = Math.min(70, Math.max(7, 5 + span * 0.9));
  const height = Math.min(40, Math.max(5, 3.5 + span * 0.45));
  const eyeY = ceilingY === undefined ? levelY + height : Math.min(levelY + height, ceilingY);
  return {
    eye: [middle[0] - dx * behind, eyeY, middle[2] - dz * behind],
    target: [middle[0] + dx * span * 0.15, levelY + 0.8, middle[2] + dz * span * 0.15],
  };
}

export function overviewPose(center: Vec3, radius: number, aspect: number): Pose {
  return { eye: cameraFor(center, radius, 45, aspect), target: center };
}

/**
 * Dolly towards a point on screen, keeping that point exactly where it is.
 *
 * Zoom has to be proportional to how far the user scrolled and to how far away the scene is: the
 * stock controls zoomed a fixed percentage per *event*, so three mouse-wheel notches moved 7% while a
 * gentle pinch and a violent one both moved 47%, and sixty notches still stopped short of the limit.
 * Scaling the eye about the point under the cursor leaves that point on the same pixel, which is what
 * makes it feel like zooming into the place you are pointing at.
 */
export function zoomPose(
  pose: Pose,
  factor: number,
  cursor: { x: number; y: number } | null,
  viewport: { width: number; height: number },
  fovDegrees: number,
  limits: { min: number; max: number },
  /** A point on the surface being zoomed into; without it the plane through the target stands in. */
  depthAt?: Vec3,
): Pose {
  const distance = Math.hypot(pose.eye[0] - pose.target[0], pose.eye[1] - pose.target[1], pose.eye[2] - pose.target[2]);
  if (distance < 1e-6) return pose;
  // Never past a limit, but always able to move towards one you are not yet at.
  const wanted = Math.min(limits.max, Math.max(limits.min, distance * factor));
  const f = wanted / distance;
  const anchor = cursor ? pointUnderCursor(pose, cursor, viewport, fovDegrees, depthAt ?? pose.target) : pose.target;
  const scale = (p: Vec3): Vec3 => [anchor[0] + (p[0] - anchor[0]) * f, anchor[1] + (p[1] - anchor[1]) * f, anchor[2] + (p[2] - anchor[2]) * f];
  return { eye: scale(pose.eye), target: scale(pose.target) };
}

/** 0 when close in, 1 once the camera is far enough back to see the whole building. */
function zoomedOut(pose: Pose, modelRadius: number): number {
  const distance = Math.hypot(pose.eye[0] - pose.target[0], pose.eye[1] - pose.target[1], pose.eye[2] - pose.target[2]);
  // Nothing until the camera is a fair way back, so close-ups and guided steps are never pulled around.
  const t = Math.min(1, Math.max(0, (distance - modelRadius * 0.6) / (modelRadius * 1.4)));
  return t * t * (3 - 2 * t);
}

/**
 * What a drag should turn about.
 *
 * Zoomed out, exactly the middle of the building, so it spins on the spot and never wanders to one
 * side. Zoomed into a corridor, the spot you are looking at, because turning about a centre tens of
 * metres away would sweep the camera off the route. The two blend smoothly with distance.
 */
export function pivotFor(pose: Pose, modelCentre: Vec3, modelRadius: number, centreHit?: Vec3 | null): Vec3 {
  const t = zoomedOut(pose, modelRadius);
  // What is at the middle of the screen: the surface there if there is one, else the building's middle
  // projected onto the view axis. Turning about a point on the view axis keeps it in the middle of the
  // screen, which is why every viewer people like uses it.
  const base = centreHit ?? axisPoint(pose, modelCentre);
  return [base[0] + (modelCentre[0] - base[0]) * t, base[1] + (modelCentre[1] - base[1]) * t, base[2] + (modelCentre[2] - base[2]) * t];
}

/** The point on the view axis nearest `p`, never behind the camera. */
function axisPoint(pose: Pose, p: Vec3): Vec3 {
  const forward = normalize([pose.target[0] - pose.eye[0], pose.target[1] - pose.eye[1], pose.target[2] - pose.eye[2]]);
  const along = Math.max(1, dot([p[0] - pose.eye[0], p[1] - pose.eye[1], p[2] - pose.eye[2]], forward));
  return [pose.eye[0] + forward[0] * along, pose.eye[1] + forward[1] * along, pose.eye[2] + forward[2] * along];
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
 * Turn the camera about `pivot` by `dTheta` (round) and `dPhi` (tip, clamped), rigidly: the eye and
 * what it looks at move together, so the pivot stays on the same pixel. Incremental, so inertia and
 * a live drag share one implementation.
 */
export function orbitBy(pose: Pose, pivot: Vec3, dTheta: number, dPhi: number): Pose {
  return orbitStep(pose, pivot, dTheta, dPhi).pose;
}

/**
 * Like `orbitBy`, but also says how much of the tip the limits refused (`spare`, radians). A drag
 * that has run out of tilt should not just die under the finger; the caller turns the spare into a
 * slide, so the model keeps following the finger.
 */
export function orbitStep(pose: Pose, pivot: Vec3, dTheta: number, dPhi: number): { pose: Pose; spare: number } {
  const { phi } = toSpherical(pose.eye, pivot);
  const pitch = clampPolar(phi + dPhi) - phi;
  const spare = dPhi - pitch;
  const about = (p: Vec3, axis: Vec3, angle: number): Vec3 => {
    const v: Vec3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
    const r = rotateAbout(v, axis, angle);
    return [pivot[0] + r[0], pivot[1] + r[1], pivot[2] + r[2]];
  };
  const yawedEye = about(pose.eye, [0, 1, 0], dTheta);
  const yawedTarget = about(pose.target, [0, 1, 0], dTheta);
  // Tilt about the camera's own horizontal axis, so dragging up and down tips the model towards you.
  const forward = normalize([yawedTarget[0] - yawedEye[0], 0, yawedTarget[2] - yawedEye[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  return { pose: { eye: about(yawedEye, right, pitch), target: about(yawedTarget, right, pitch) }, spare };
}

/** Slide the view up the screen by `pixels` (positive moves the model up), at the depth of `pivot`. */
export function slideVertical(pose: Pose, pivot: Vec3, pixels: number, viewportHeight: number, fovDegrees: number): Pose {
  const forward = normalize([pose.target[0] - pose.eye[0], pose.target[1] - pose.eye[1], pose.target[2] - pose.eye[2]]);
  const up = cross(normalize(cross(forward, [0, 1, 0])), forward);
  const depth = Math.max(1, dot([pivot[0] - pose.eye[0], pivot[1] - pose.eye[1], pivot[2] - pose.eye[2]], forward));
  const metres = ((2 * Math.tan((fovDegrees * Math.PI) / 360) * depth) / Math.max(1, viewportHeight)) * pixels;
  // The model moves up the screen when the camera moves down.
  const shift: Vec3 = [-up[0] * metres, -up[1] * metres, -up[2] * metres];
  return { eye: [pose.eye[0] + shift[0], pose.eye[1] + shift[1], pose.eye[2] + shift[2]], target: [pose.target[0] + shift[0], pose.target[1] + shift[1], pose.target[2] + shift[2]] };
}

/** Radians of turn per screen width (round) and per screen height (tip). */
export const TURN_PER_WIDTH = Math.PI;
export const TIP_PER_HEIGHT = Math.PI / 2;

/**
 * Turn the building for a drag of (dx, dy) pixels. Dragging right brings the near side of the model
 * to the right; dragging down tips the top towards you.
 */
export function grabRotate(grab: Grab, cursor: { x: number; y: number }): Pose {
  // A flick can report a delta far outside the window.
  const dx = clamp(cursor.x - grab.cursor.x, grab.viewport.width);
  const dy = clamp(cursor.y - grab.cursor.y, grab.viewport.height);
  return orbitBy(grab.pose, grab.pivot, -(dx / Math.max(1, grab.viewport.width)) * TURN_PER_WIDTH, -(dy / Math.max(1, grab.viewport.height)) * TIP_PER_HEIGHT);
}

/** Where fingers (or a cursor) are: their midpoint, spread and the angle between them. */
export interface Touchpoint {
  x: number;
  y: number;
  spread: number;
  angle: number;
}

/**
 * Pinch, twist and slide at once, the way a map does: the spot between the fingers when they went
 * down stays between them. Spread scales the distance, twist turns the model about the vertical, and
 * the midpoint's own movement slides it. Computed from the pose at the start of the gesture, so it
 * never drifts however long the fingers stay down.
 */
export function gesturePose(
  start: { pose: Pose; pivot: Vec3; viewport: { width: number; height: number }; fovDegrees: number; limits: { min: number; max: number } },
  from: Touchpoint,
  to: Touchpoint,
): Pose {
  const { pose, viewport, fovDegrees, limits } = start;
  const anchor = pointUnderCursor(pose, from, viewport, fovDegrees, start.pivot);
  const distance = Math.hypot(pose.eye[0] - pose.target[0], pose.eye[1] - pose.target[1], pose.eye[2] - pose.target[2]);
  const spread = Math.max(1, to.spread);
  const wanted = Math.min(limits.max, Math.max(limits.min, distance * (Math.max(1, from.spread) / spread)));
  const f = distance > 1e-6 ? wanted / distance : 1;
  let twist = to.angle - from.angle;
  while (twist > Math.PI) twist -= 2 * Math.PI;
  while (twist < -Math.PI) twist += 2 * Math.PI;

  const move = (p: Vec3): Vec3 => {
    const v: Vec3 = [(p[0] - anchor[0]) * f, (p[1] - anchor[1]) * f, (p[2] - anchor[2]) * f];
    const r = rotateAbout(v, [0, 1, 0], twist);
    return [anchor[0] + r[0], anchor[1] + r[1], anchor[2] + r[2]];
  };
  const scaled: Pose = { eye: move(pose.eye), target: move(pose.target) };
  const under = pointUnderCursor(scaled, to, viewport, fovDegrees, anchor);
  const shift: Vec3 = [anchor[0] - under[0], anchor[1] - under[1], anchor[2] - under[2]];
  const add = (p: Vec3): Vec3 => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]];
  return { eye: add(scaled.eye), target: add(scaled.target) };
}

/**
 * Keep what the camera looks at inside the building's neighbourhood, so a slide or a fling can never
 * carry the model out of sight with nothing to grab.
 */
export function clampPose(pose: Pose, centre: Vec3, radius: number): Pose {
  // Zoomed out the building stays put in the middle; zoomed in there is room to wander along a corridor.
  const limit = radius * (0.25 + 0.85 * (1 - zoomedOut(pose, radius)));
  let dx = pose.target[0] - centre[0];
  let dz = pose.target[2] - centre[2];
  const out = Math.hypot(dx, dz);
  let sx = 0;
  let sz = 0;
  if (out > limit) {
    dx /= out;
    dz /= out;
    sx = -dx * (out - limit);
    sz = -dz * (out - limit);
  }
  const sy = Math.min(centre[1] + radius, Math.max(centre[1] - radius, pose.target[1])) - pose.target[1];
  if (!sx && !sz && !sy) return pose;
  return {
    eye: [pose.eye[0] + sx, pose.eye[1] + sy, pose.eye[2] + sz],
    target: [pose.target[0] + sx, pose.target[1] + sy, pose.target[2] + sz],
  };
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
