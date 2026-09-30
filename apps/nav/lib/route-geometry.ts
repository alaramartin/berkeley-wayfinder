/**
 * A route as drawable geometry: one polyline per level, following the corridor centrelines the router
 * actually costed, rather than straight chords between nodes.
 */
import type { Route, RouteStep } from "@wf/routing";
import type { Point } from "@wf/schema";
import { SLAB_THICKNESS, type Vec3, toScene } from "./scene";

/** The ribbon is painted just above the top of the slab, not inside it. */
export const RIBBON_Y = SLAB_THICKNESS + 0.04;

export interface LevelRibbon {
  levelId: string;
  /** Scene points relative to the level's own floor, so the ribbon rides with it as levels move. */
  points: Vec3[];
  /** Metres walked at each point. */
  distances: number[];
  /** Where each route step ends along `points`, for per-step camera framing and fading. */
  stepEnds: { stepIndex: number; pointIndex: number }[];
}

export interface Transition {
  kind: "stair" | "elevator";
  fromLevelId: string;
  toLevelId: string;
  at: Point;
  to: Point;
  stepIndex: number;
}

/** One or more flights in the same shaft, shown as a single "up to Level 3". */
export interface MergedTransition {
  kind: "stair" | "elevator";
  fromLevelId: string;
  toLevelId: string;
  at: Point;
  to: Point;
  stepIndex: number;
}

export interface RouteGeometry {
  ribbons: LevelRibbon[];
  transitions: Transition[];
  /** Transitions collapsed per shaft; what the scene draws and the step list describes. */
  risers: MergedTransition[];
  /** Total metres, matching the route's own figure. */
  meters: number;
}

const near = (a: Point, b: Point, tolerance = 0.01) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tolerance;

/** How far the ribbon reaches past the doorway. Doors sit on the corridor centreline, roughly a metre
 * outside the room wall, so a shorter stub never actually gets inside the room. */
const DOORWAY_STUB_M = 2.2;
/** Points closer together than this only make the ribbon's corners fold; they add nothing to draw. */
const MIN_SPACING_M = 0.35;

/** The stretch of a polyline within `meters` of one end. */
function trim(line: Point[], meters: number, fromStart: boolean): Point[] {
  const ordered = fromStart ? line : [...line].reverse();
  const out: Point[] = [ordered[0]!];
  let walked = 0;
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1]!;
    const b = ordered[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (walked + seg >= meters) {
      const f = seg === 0 ? 0 : (meters - walked) / seg;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      break;
    }
    out.push(b);
    walked += seg;
  }
  return fromStart ? out : out.reverse();
}

/**
 * A room's node sits in the middle of the room, so the doorway step is a hop of up to 10 m across it.
 * Routing needs that hop; drawing it at full width turns the ribbon into a carpet through the room, so
 * only the stretch just inside the door is drawn.
 */
function doorwayStub(step: RouteStep, line: Point[]): Point[] {
  const length = polylineLength(line);
  if (length <= DOORWAY_STUB_M) return line;
  // Keep the end nearest the door; when both ends are rooms (a room entered through another one),
  // keep the arrival end.
  const doorAtStart = step.from.kind === "door";
  return trim(line, DOORWAY_STUB_M, doorAtStart);
}

function polylineLength(line: Point[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  return total;
}

/** Drop points that sit on top of each other, keeping the ends and every step boundary. */
function thin(ribbon: LevelRibbon): LevelRibbon {
  const keep = new Set<number>([0, ribbon.points.length - 1, ...ribbon.stepEnds.map((e) => e.pointIndex)]);
  const indices: number[] = [];
  let lastKept = -1;
  for (let i = 0; i < ribbon.points.length; i++) {
    const a = ribbon.distances[lastKept] ?? Number.NEGATIVE_INFINITY;
    if (keep.has(i) || ribbon.distances[i]! - a >= MIN_SPACING_M) {
      indices.push(i);
      lastKept = i;
    }
  }
  const remap = new Map(indices.map((old, next) => [old, next]));
  return {
    levelId: ribbon.levelId,
    points: indices.map((i) => ribbon.points[i]!),
    distances: indices.map((i) => ribbon.distances[i]!),
    stepEnds: ribbon.stepEnds.map((e) => ({ stepIndex: e.stepIndex, pointIndex: remap.get(e.pointIndex) ?? 0 })),
  };
}

/** A step's polyline, oriented from the step's `from` node to its `to` node. */
function orientedPolyline(step: RouteStep): Point[] {
  const line = step.edge.polyline.length >= 2 ? step.edge.polyline : [[step.from.x, step.from.y] as Point, [step.to.x, step.to.y] as Point];
  // buildGraph already reverses the polyline on the back edge, but a mismatch here would draw the
  // route backwards along that edge, so fall back to the node positions instead of trusting it.
  const start: Point = [step.from.x, step.from.y];
  const end: Point = [step.to.x, step.to.y];
  if (near(line[0]!, start, 0.5)) return line;
  if (near(line[line.length - 1]!, start, 0.5)) return [...line].reverse();
  return [start, end];
}

export function routeGeometry(route: Route): RouteGeometry {
  const ribbons: LevelRibbon[] = [];
  const transitions: Transition[] = [];
  let current: LevelRibbon | null = null;
  let plan: Point[] = [];
  let meters = 0;

  const flush = () => {
    if (current && plan.length >= 2) ribbons.push(thin(current));
    current = null;
    plan = [];
  };

  const push = (levelId: string, point: Point, stepIndex: number) => {
    if (!current || current.levelId !== levelId) {
      flush();
      current = { levelId, points: [], distances: [], stepEnds: [] };
      plan = [];
    }
    const last = plan[plan.length - 1];
    if (last && near(last, point)) return;
    const walked = last ? Math.hypot(point[0] - last[0], point[1] - last[1]) : 0;
    const total = (current.distances[current.distances.length - 1] ?? 0) + walked;
    plan.push(point);
    current.points.push(toScene(point, RIBBON_Y));
    current.distances.push(total);
    const end = current.stepEnds[current.stepEnds.length - 1];
    if (end?.stepIndex === stepIndex) end.pointIndex = current.points.length - 1;
    else current.stepEnds.push({ stepIndex, pointIndex: current.points.length - 1 });
  };

  route.steps.forEach((step, stepIndex) => {
    if (step.edge.kind === "stair" || step.edge.kind === "elevator") {
      transitions.push({
        kind: step.edge.kind,
        fromLevelId: step.from.levelId,
        toLevelId: step.to.levelId,
        at: [step.from.x, step.from.y],
        to: [step.to.x, step.to.y],
        stepIndex,
      });
      flush();
      return;
    }
    const line = orientedPolyline(step);
    const drawn = step.edge.kind === "doorway" ? doorwayStub(step, line) : line;
    for (const point of drawn) push(step.to.levelId, point, stepIndex);
    // Doorway hops cost nothing to walk but are real metres on screen; counting them keeps the drawn
    // length and the quoted distance in step.
    meters += step.edge.kind === "doorway" ? polylineLength(drawn) : step.edge.meters;
  });
  flush();

  return { ribbons, transitions, risers: mergeTransitions(transitions), meters };
}

/**
 * A shaft that passes through a floor without stopping produces one transition per flight (L1->L2,
 * L2->L3). Drawing each one separately contradicts the step list, which says "up to Level 3" once.
 */
export function mergeTransitions(transitions: Transition[]): MergedTransition[] {
  const out: MergedTransition[] = [];
  for (const transition of transitions) {
    const previous = out[out.length - 1];
    const continues = previous && previous.kind === transition.kind && previous.toLevelId === transition.fromLevelId && transition.stepIndex === previous.stepIndex + 1;
    if (continues && previous) {
      previous.toLevelId = transition.toLevelId;
      previous.to = transition.to;
      continue;
    }
    out.push({ ...transition });
  }
  return out;
}

/** The ribbon and point index a route step ends at, for framing the camera on that step. */
export function locateStep(geometry: RouteGeometry, stepIndex: number): { ribbon: LevelRibbon; pointIndex: number } | null {
  for (const ribbon of geometry.ribbons) {
    for (const end of ribbon.stepEnds) {
      if (end.stepIndex === stepIndex) return { ribbon, pointIndex: end.pointIndex };
    }
  }
  return null;
}

/** Point at a given distance along a ribbon, clamped to its ends. */
export function pointAtDistance(ribbon: LevelRibbon, distance: number): Vec3 {
  const { points, distances } = ribbon;
  if (!points.length) return [0, 0, 0];
  if (distance <= 0) return points[0]!;
  const last = distances[distances.length - 1]!;
  if (distance >= last) return points[points.length - 1]!;
  for (let i = 1; i < points.length; i++) {
    if (distances[i]! < distance) continue;
    const span = distances[i]! - distances[i - 1]!;
    const f = span === 0 ? 0 : (distance - distances[i - 1]!) / span;
    const a = points[i - 1]!;
    const b = points[i]!;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  return points[points.length - 1]!;
}

/** How far ahead of the walker stays bright, and where the path has faded out. */
const BRIGHT_M = 18;
const FADED_M = 35;

/** Ribbon opacity at a distance along the route, given where the walker is. */
export function alphaAt(distance: number, activeDistance: number | null): number {
  if (activeDistance === null) return 0.8;
  if (distance < activeDistance - 1) return 0.22;
  const ahead = distance - activeDistance;
  if (ahead <= BRIGHT_M) return 0.95;
  if (ahead >= FADED_M) return 0.15;
  return 0.95 - ((ahead - BRIGHT_M) / (FADED_M - BRIGHT_M)) * 0.8;
}
