/**
 * Turn a route into sentences. Distances are deliberately vague ("about 30 m"): the plans are traced
 * from placard photos, so implying precision would be wrong.
 *
 * Corridor polylines come from a skeleton and wobble by a metre or two, which would otherwise produce
 * a "turn" every few steps. Each leg between vertical moves is simplified before turns are read off it.
 */
import type { Point, Room } from "@wf/schema";
import type { GraphNode, RouteGraph } from "./graph";
import type { Route, RouteStep } from "./route";

export type TurnKind = "straight" | "slight-left" | "slight-right" | "left" | "right" | "sharp-left" | "sharp-right";

export interface Instruction {
  kind: "start" | "walk" | "vertical" | "arrive";
  text: string;
  meters?: number;
  levelId: string;
  /** Node the step ends at, for highlighting in the app. */
  nodeId: string;
}

const ROUND_TO_M = 5;
/** Corridor jitter below this is not a turn. */
const SIMPLIFY_TOLERANCE_M = 2;

export function approxDistance(meters: number): string {
  if (meters < 8) return "a few steps";
  return `about ${Math.max(ROUND_TO_M, Math.round(meters / ROUND_TO_M) * ROUND_TO_M)} m`;
}

export function approxTime(seconds: number): string {
  if (seconds < 45) return "under a minute";
  return `about ${Math.round(seconds / 60)} min`;
}

export function turnFrom(previous: number, next: number): TurnKind {
  let delta = ((next - previous + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (delta <= -Math.PI) delta += 2 * Math.PI;
  const degrees = (delta * 180) / Math.PI;
  const magnitude = Math.abs(degrees);
  if (magnitude < 30) return "straight";
  const side = degrees > 0 ? "left" : "right";
  if (magnitude < 60) return `slight-${side}` as TurnKind;
  if (magnitude <= 135) return side as TurnKind;
  return `sharp-${side}` as TurnKind;
}

const TURN_TEXT: Record<TurnKind, string> = {
  straight: "Continue straight",
  "slight-left": "Bear left",
  "slight-right": "Bear right",
  left: "Turn left",
  right: "Turn right",
  "sharp-left": "Turn sharply left",
  "sharp-right": "Turn sharply right",
};

function roomLabel(room: Room): string {
  if (room.number && room.name) return `${room.number} (${room.name})`;
  return room.number ?? room.name ?? room.id;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Ramer-Douglas-Peucker: drop points that sit within `tolerance` of the line they lie on. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let worst = 0;
  let index = 0;
  const span = distance(first, last);
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const d =
      span === 0
        ? distance(p, first)
        : Math.abs((last[0] - first[0]) * (first[1] - p[1]) - (first[0] - p[0]) * (last[1] - first[1])) / span;
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

/** A stretch of walking between vertical moves, with the doors passed along it. */
interface Leg {
  points: Point[];
  /** Distance along the leg, and the room whose door sits there. */
  passed: { at: number; room: Room; side: "left" | "right" }[];
  /** Distance along the leg where each graph node is reached, for highlighting a run's end. */
  marks: { at: number; nodeId: string }[];
  endNode: GraphNode;
  levelId: string;
}

function legsOf(graph: RouteGraph, route: Route): { legs: Leg[]; verticals: Map<number, RouteStep[]> } {
  const legs: Leg[] = [];
  const verticals = new Map<number, RouteStep[]>();
  let points: Point[] = [];
  let passed: Leg["passed"] = [];
  let marks: Leg["marks"] = [];
  let run = 0;
  let endNode = route.nodes[0]!;

  const flush = () => {
    if (points.length >= 2) legs.push({ points, passed, marks, endNode, levelId: endNode.levelId });
    points = [];
    passed = [];
    marks = [];
    run = 0;
  };

  for (const step of route.steps) {
    if (step.edge.kind === "stair" || step.edge.kind === "elevator") {
      flush();
      const list = verticals.get(legs.length) ?? [];
      list.push(step);
      verticals.set(legs.length, list);
      endNode = step.to;
      continue;
    }
    if (step.edge.meters === 0) continue; // the step through a doorway itself
    const line = step.edge.polyline;
    for (const p of line) if (!points.length || distance(points[points.length - 1]!, p) > 0.01) points.push(p);
    run += step.edge.meters;
    marks.push({ at: run, nodeId: step.to.id });
    endNode = step.to;
    if (step.to.kind === "door" && step.to.roomId) {
      const room = graph.rooms.get(step.to.roomId);
      const side = room?.doors[0]?.side ?? "left";
      if (room) passed.push({ at: run, room, side });
    }
  }
  flush();
  return { legs, verticals };
}

/** Sentences for one leg: simplify, then merge consecutive straight segments. */
function legInstructions(leg: Leg, isFirst: boolean): Instruction[] {
  const simplified = simplify(leg.points, SIMPLIFY_TOLERANCE_M);
  const out: Instruction[] = [];
  let heading: number | null = null;
  /** The turn that started the run being accumulated. */
  let runTurn: TurnKind = "straight";
  let meters = 0;
  let runStart = 0;
  let travelled = 0;

  const emit = () => {
    if (meters <= 0) return;
    const seen = leg.passed
      .filter((p) => p.at > runStart && p.at <= travelled)
      .slice(0, 2)
      .map((p) => `${roomLabel(p.room)} on your ${p.side}`);
    const lead = out.length === 0 && isFirst ? `Walk ${approxDistance(meters)}` : `${TURN_TEXT[runTurn]}, then walk ${approxDistance(meters)}`;
    // The node closest to where this run ends, so the app can highlight it.
    const mark = leg.marks.filter((m) => m.at <= travelled + 0.01).at(-1);
    out.push({
      kind: "walk",
      text: seen.length ? `${lead}, past ${seen.join(" and ")}` : lead,
      meters,
      levelId: leg.levelId,
      nodeId: mark?.nodeId ?? leg.endNode.id,
    });
    runStart = travelled;
    meters = 0;
  };

  for (let i = 1; i < simplified.length; i++) {
    const a = simplified[i - 1]!;
    const b = simplified[i]!;
    const segment = distance(a, b);
    const bearing = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (heading !== null) {
      const turn = turnFrom(heading, bearing);
      if (turn !== "straight") {
        emit();
        runTurn = turn;
      }
    }
    heading = bearing;
    meters += segment;
    travelled += segment;
  }
  emit();
  return out;
}

function levelName(graph: RouteGraph, levelId: string): string {
  return graph.levels.get(levelId)?.displayName ?? levelId;
}

export function instructions(graph: RouteGraph, route: Route): Instruction[] {
  const out: Instruction[] = [];
  if (!route.steps.length) return out;

  const start = route.nodes[0]!;
  const startRoom = start.roomId ? graph.rooms.get(start.roomId) : undefined;
  const entrance = graph.building.entrances.find((e) => e.nodeId === start.id);
  out.push({
    kind: "start",
    text: startRoom ? `Start at ${roomLabel(startRoom)}` : entrance ? `Start at ${entrance.name}` : `Start on Level ${levelName(graph, start.levelId)}`,
    levelId: start.levelId,
    nodeId: start.id,
  });

  const { legs, verticals } = legsOf(graph, route);
  const emitVerticals = (index: number) => {
    const steps = verticals.get(index);
    if (!steps?.length) return;
    // Several flights in the same shaft read as one instruction.
    const first = steps[0]!;
    const last = steps[steps.length - 1]!;
    const up = last.to.z > first.from.z;
    const kind = first.edge.kind === "elevator" ? "elevator" : "stairs";
    out.push({
      kind: "vertical",
      text: `Take the ${kind} ${up ? "up" : "down"} to Level ${levelName(graph, last.to.levelId)}`,
      levelId: last.to.levelId,
      nodeId: last.to.id,
    });
  };

  legs.forEach((leg, i) => {
    emitVerticals(i);
    for (const step of legInstructions(leg, out.length === 1)) out.push(step);
  });
  emitVerticals(legs.length);

  const end = route.nodes[route.nodes.length - 1]!;
  const endRoom = end.roomId ? graph.rooms.get(end.roomId) : undefined;
  const endEntrance = graph.building.entrances.find((e) => e.nodeId === end.id);
  let text = endRoom ? `Arrive at ${roomLabel(endRoom)}` : endEntrance ? `Arrive at ${endEntrance.name}` : "Arrive";
  if (endRoom?.enteredVia) {
    const host = graph.rooms.get(endRoom.enteredVia);
    if (host) text += `, which is inside ${roomLabel(host)}`;
  }
  if (endRoom?.doors[0] && !endRoom.doors[0].verified) text += ". The door position is unconfirmed";
  out.push({ kind: "arrive", text, levelId: end.levelId, nodeId: end.id });
  return out;
}

/** One-line summary: "about 3 min · about 150 m · 2 levels". */
export function summary(route: Route): string {
  const parts = [approxTime(route.seconds), approxDistance(route.meters)];
  if (route.levelIds.length > 1) parts.push(`${route.levelIds.length} levels`);
  return parts.join(" · ");
}
