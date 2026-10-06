/**
 * One camera controller for every input device.
 *
 * The scheme is the one the viewers people already know use (Sketchfab, Matterport, Google Maps):
 *
 *   one finger / left mouse   turn the model on the spot
 *   two fingers               pinch to zoom, twist to turn and slide, all at once
 *   right / middle / shift    slide (mouse)
 *   wheel, trackpad swipe     zoom towards the cursor
 *   double tap / click        zoom in on that spot
 *   let go mid-swipe          it keeps coasting, then settles
 *
 * It exists because two handlers on one canvas (the stock OrbitControls plus our own) fought over
 * every touch: a second finger landing left one of them in a state that ignored input until all
 * fingers lifted. Here there is a single state machine, so that cannot happen, and it is pure — no
 * DOM, no three — so the transitions are unit-tested.
 */
import { type Pose, type Touchpoint, clampPose, gesturePose, orbitBy, orbitStep, pivotFor, recentre, slideVertical, zoomPose, TIP_PER_HEIGHT, TURN_PER_WIDTH } from "./camera";
import { zoomFactor } from "./input";
import type { Vec3 } from "./scene";

export interface ControllerEnv {
  getPose(): Pose;
  setPose(pose: Pose): void;
  viewport(): { width: number; height: number };
  fovDegrees: number;
  limits(): { min: number; max: number };
  centre: Vec3;
  radius: number;
  /** The user took the camera: stop any guided flight. Called once a gesture really starts, not on a tap. */
  onTakeover(): void;
  /** Glide to a pose (double tap). */
  animateTo(pose: Pose, ms: number): void;
  /** The surface point under a screen position, if the model is there. Zooms and slides hold it under the fingers. */
  pick?(x: number, y: number): Vec3 | null;
}

export interface PointerInfo {
  id: number;
  x: number;
  y: number;
  time: number;
  type?: "mouse" | "touch" | "pen";
  button?: number;
  shift?: boolean;
}

/** A press that moves less than this is still a tap. */
const TAP_SLOP_PX = 6;
const TAP_MAX_MS = 300;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_DISTANCE_PX = 32;
/** Angular velocity older than this at release is stale: the finger had stopped. */
const STALE_MS = 80;
/** Coasting: velocity is multiplied by exp(-dt / this). */
const COAST_TIME_MS = 260;
/** Below this many radians per ms the coast is over. */
const COAST_STOP = 0.00002;
/** Each double tap moves this much closer. */
const DOUBLE_TAP_ZOOM = 0.45;

type Mode = "idle" | "orbit" | "slide" | "pinch";

interface Tracked {
  x: number;
  y: number;
}

export interface Controller {
  down(p: PointerInfo): void;
  move(p: PointerInfo): void;
  up(p: PointerInfo): void;
  cancel(id: number): void;
  wheel(e: { deltaY: number; deltaMode: number; ctrlKey: boolean; x: number; y: number }): void;
  /** Advance coasting; returns true while the camera is still moving on its own. */
  tick(dtMs: number): boolean;
  /** Cancel everything (blur, lost capture, unmount). */
  reset(): void;
  /** A guided flight took over: stop treating the camera as user-placed. */
  release(): void;
  readonly mode: Mode;
  readonly pointerCount: number;
}

export function createController(env: ControllerEnv): Controller {
  const pointers = new Map<number, Tracked>();
  let mode: Mode = "idle";
  let start: { pose: Pose; pivot: Vec3; from: Touchpoint } | null = null;
  let taken = false;
  /** Where the first pointer went down, for the tap slop. */
  let origin: { x: number; y: number; time: number; moved: boolean } | null = null;
  let last: { x: number; y: number; time: number } | null = null;
  let velocity = { theta: 0, phi: 0 };
  let velocityAt = 0;
  let coasting: { pivot: Vec3 } | null = null;
  let lastTap: { x: number; y: number; time: number } | null = null;
  let pivot: Vec3 = env.centre;

  const set = (pose: Pose) => env.setPose(clampPose(pose, env.centre, env.radius));
  const take = () => {
    if (taken) return;
    taken = true;
    env.onTakeover();
  };

  const touchpoint = (): Touchpoint => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) {
      const only = a ?? { x: 0, y: 0 };
      return { x: only.x, y: only.y, spread: 1, angle: 0 };
    }
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  const begin = (next: Mode) => {
    mode = next;
    const pose = env.getPose();
    const { width, height } = env.viewport();
    pivot = pivotFor(pose, env.centre, env.radius, env.pick?.(width / 2, height / 2));
    const from = touchpoint();
    // Pinch and slide hold the actual surface under the fingers; without a hit, the model's middle.
    start = { pose, pivot: next === "orbit" ? pivot : (env.pick?.(from.x, from.y) ?? pivot), from };
    velocity = { theta: 0, phi: 0 };
  };

  /**
   * One step of turning. Tilt the limits refuse becomes a slide, so a drag never goes dead; when
   * nothing was refused the building eases towards the middle of the screen as it turns.
   */
  const turn = (pose: Pose, about: Vec3, dTheta: number, dPhi: number, height: number): Pose => {
    const step = orbitStep(pose, about, dTheta, dPhi);
    if (Math.abs(step.spare) > 1e-6) {
      return slideVertical(step.pose, about, (step.spare / TIP_PER_HEIGHT) * height, height, env.fovDegrees);
    }
    return recentre(step.pose, env.centre, env.radius, 0.06);
  };

  const geometry = () => ({ viewport: env.viewport(), fovDegrees: env.fovDegrees, limits: env.limits() });

  return {
    get mode() {
      return mode;
    },
    get pointerCount() {
      return pointers.size;
    },

    down(p) {
      coasting = null;
      if (pointers.has(p.id)) return;
      // A third finger is ignored rather than allowed to scramble the pinch.
      if (pointers.size >= 2) return;
      pointers.set(p.id, { x: p.x, y: p.y });
      if (pointers.size === 1) {
        taken = false;
        origin = { x: p.x, y: p.y, time: p.time, moved: false };
        last = { x: p.x, y: p.y, time: p.time };
        const slide = p.type === "mouse" && (p.button === 1 || p.button === 2 || p.shift === true);
        begin(slide ? "slide" : "orbit");
      } else {
        // Second finger: hand over from turning to pinching, from wherever the camera is now.
        if (origin) origin.moved = true;
        take();
        begin("pinch");
      }
    },

    move(p) {
      const tracked = pointers.get(p.id);
      if (!tracked || !start) return;
      tracked.x = p.x;
      tracked.y = p.y;

      if (mode === "pinch" || mode === "slide") {
        if (mode === "slide" && origin && !origin.moved) {
          if (Math.hypot(p.x - origin.x, p.y - origin.y) < TAP_SLOP_PX) return;
          origin.moved = true;
        }
        take();
        set(gesturePose({ pose: start.pose, pivot: start.pivot, ...geometry() }, start.from, touchpoint()));
        return;
      }

      if (mode !== "orbit" || !last || !origin) return;
      if (!origin.moved) {
        if (Math.hypot(p.x - origin.x, p.y - origin.y) < TAP_SLOP_PX) return;
        origin.moved = true;
        // Start turning from here, not from where the finger first landed, so there is no jump.
        last = { x: p.x, y: p.y, time: p.time };
        take();
        return;
      }
      const { width, height } = env.viewport();
      const dTheta = (-(p.x - last.x) / Math.max(1, width)) * TURN_PER_WIDTH;
      const dPhi = (-(p.y - last.y) / Math.max(1, height)) * TIP_PER_HEIGHT;
      if (dTheta === 0 && dPhi === 0) return;
      const dt = Math.max(1, p.time - last.time);
      // Smoothed, so one jittery sample does not become the fling.
      velocity = { theta: velocity.theta * 0.5 + (dTheta / dt) * 0.5, phi: velocity.phi * 0.5 + (dPhi / dt) * 0.5 };
      velocityAt = p.time;
      last = { x: p.x, y: p.y, time: p.time };
      // While turning, the building eases towards the middle of the screen, so it never ends up off to a side.
      set(turn(env.getPose(), pivot, dTheta, dPhi, height));
    },

    up(p) {
      if (!pointers.has(p.id)) return;
      pointers.delete(p.id);
      const wasMode = mode;

      if (pointers.size === 1) {
        // Back to one finger after a pinch: carry on turning from the finger that is left, without a jump.
        const rest = [...pointers.values()][0]!;
        last = { x: rest.x, y: rest.y, time: p.time };
        if (origin) origin.moved = true;
        begin("orbit");
        return;
      }
      if (pointers.size > 0) return;

      mode = "idle";
      start = null;
      const o = origin;
      origin = null;
      if (wasMode === "orbit" && o && !o.moved && p.time - o.time < TAP_MAX_MS) {
        const double = lastTap && p.time - lastTap.time < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_TAP_DISTANCE_PX;
        if (double) {
          lastTap = null;
          take();
          const pose = env.getPose();
          env.animateTo(zoomPose(pose, DOUBLE_TAP_ZOOM, { x: p.x, y: p.y }, env.viewport(), env.fovDegrees, env.limits(), env.pick?.(p.x, p.y) ?? undefined), 240);
        } else lastTap = { x: p.x, y: p.y, time: p.time };
        return;
      }
      lastTap = null;
      if (wasMode === "orbit" && p.time - velocityAt < STALE_MS && Math.hypot(velocity.theta, velocity.phi) > COAST_STOP * 8) {
        coasting = { pivot };
      }
    },

    cancel(id) {
      if (!pointers.has(id)) return;
      pointers.delete(id);
      if (pointers.size === 0) {
        mode = "idle";
        start = null;
        origin = null;
      } else if (pointers.size === 1) {
        const rest = [...pointers.values()][0]!;
        last = { x: rest.x, y: rest.y, time: last?.time ?? 0 };
        begin("orbit");
      }
    },

    wheel(e) {
      coasting = null;
      taken = true;
      env.onTakeover();
      const pose = env.getPose();
      set(zoomPose(pose, zoomFactor(e), { x: e.x, y: e.y }, env.viewport(), env.fovDegrees, env.limits(), env.pick?.(e.x, e.y) ?? undefined));
    },

    tick(dtMs) {
      if (!coasting) {
        // At rest and zoomed out, drift back so the whole building is framed.
        // Only after the user has moved things themselves: a guided step's framing is left alone.
        if (taken && pointers.size === 0 && mode === "idle") {
          const pose = env.getPose();
          const next = recentre(pose, env.centre, env.radius, 1 - Math.exp(-dtMs / 500));
          if (next !== pose) env.setPose(next);
        }
        return false;
      }
      const decay = Math.exp(-dtMs / COAST_TIME_MS);
      velocity = { theta: velocity.theta * decay, phi: velocity.phi * decay };
      if (Math.hypot(velocity.theta, velocity.phi) < COAST_STOP) {
        coasting = null;
        return false;
      }
      set(turn(env.getPose(), coasting.pivot, velocity.theta * dtMs, velocity.phi * dtMs, env.viewport().height));
      return true;
    },

    release() {
      taken = false;
    },

    reset() {
      pointers.clear();
      mode = "idle";
      start = null;
      origin = null;
      coasting = null;
    },
  };
}
