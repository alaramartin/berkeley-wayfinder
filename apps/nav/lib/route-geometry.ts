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

export interface RouteGeometry {
  ribbons: LevelRibbon[];
  transitions: Transition[];
  /** Total metres, matching the route's own figure. */
  meters: number;
}

const near = (a: Point, b: Point, tolerance = 0.01) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tolerance;

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
    if (current && plan.length >= 2) ribbons.push(current);
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
    for (const point of orientedPolyline(step)) push(step.to.levelId, point, stepIndex);
    meters += step.edge.meters;
  });
  flush();

  return { ribbons, transitions, meters };
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
