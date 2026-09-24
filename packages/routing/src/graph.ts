/**
 * Routing graph over canonical building data.
 *
 * Corridor edges carry a polyline in building-local meters; a room's door splits the edge it sits on
 * into two pieces at `t`, so routes arrive at the real doorway rather than at the nearest junction.
 * Shafts become vertical edges between the levels they link.
 */
import { pointAlong, polylineLength } from "@wf/geometry";
import type { Access, Building, Door, Edge, EdgeKind, Level, Point, Room } from "@wf/schema";

/** A node in the routing graph: a corridor node, a door, or a room/entrance stand-in. */
export interface GraphNode {
  id: string;
  levelId: string;
  /** Building-local metres. */
  x: number;
  y: number;
  /** Level elevation plus nothing else; floors are flat. */
  z: number;
  kind: "junction" | "door" | "stair" | "elevator" | "entrance" | "room";
  /** Set for door and room nodes. */
  roomId?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind | "doorway";
  access: Access;
  accessible: boolean;
  /** Metres walked along this edge (0 for the step through a doorway). */
  meters: number;
  /** Levels crossed, signed; 0 on one floor. */
  levels: number;
  /** Polyline in metres, from `from` to `to`, for drawing. */
  polyline: Point[];
}

export interface RouteGraph {
  building: Building;
  levels: Map<string, Level>;
  nodes: Map<string, GraphNode>;
  /** Outgoing edges by node id; every edge appears in both directions. */
  adjacency: Map<string, GraphEdge[]>;
  rooms: Map<string, Room>;
  /** Room id -> the door nodes that reach it. */
  roomDoors: Map<string, string[]>;
}

const doorNodeId = (roomId: string, i: number) => `${roomId}#d${i}`;
const roomNodeId = (roomId: string) => `${roomId}#room`;

function add(graph: RouteGraph, edge: GraphEdge): void {
  const back: GraphEdge = { ...edge, id: `${edge.id}~r`, from: edge.to, to: edge.from, levels: -edge.levels, polyline: [...edge.polyline].reverse() };
  for (const e of [edge, back]) {
    const list = graph.adjacency.get(e.from);
    if (list) list.push(e);
    else graph.adjacency.set(e.from, [e]);
  }
}

function node(graph: RouteGraph, n: GraphNode): void {
  graph.nodes.set(n.id, n);
  if (!graph.adjacency.has(n.id)) graph.adjacency.set(n.id, []);
}

/** Split a corridor polyline at a door's `t`, in metres along the line. */
function splitAt(polyline: Point[], t: number): { at: Point; before: Point[]; after: Point[] } {
  const at = pointAlong(polyline, t);
  const total = polylineLength(polyline);
  const target = total * t;
  const before: Point[] = [polyline[0]!];
  const after: Point[] = [at];
  let run = 0;
  for (let i = 1; i < polyline.length; i++) {
    const seg = Math.hypot(polyline[i]![0] - polyline[i - 1]![0], polyline[i]![1] - polyline[i - 1]![1]);
    if (run + seg <= target) before.push(polyline[i]!);
    else after.push(polyline[i]!);
    run += seg;
  }
  before.push(at);
  return { at, before, after };
}

export function buildGraph(building: Building, levels: Level[]): RouteGraph {
  const graph: RouteGraph = {
    building,
    levels: new Map(levels.map((l) => [l.id, l])),
    nodes: new Map(),
    adjacency: new Map(),
    rooms: new Map(),
    roomDoors: new Map(),
  };

  for (const level of levels) {
    const z = level.elevationM;
    for (const n of level.nodes) node(graph, { id: n.id, levelId: level.id, x: n.x, y: n.y, z, kind: n.kind });

    // Doors that share an edge split it in order, so each piece keeps its true length.
    const doorsByEdge = new Map<string, { room: Room; door: Door; index: number }[]>();
    for (const room of level.rooms) {
      graph.rooms.set(room.id, room);
      room.doors.forEach((door, index) => {
        const list = doorsByEdge.get(door.edgeId);
        if (list) list.push({ room, door, index });
        else doorsByEdge.set(door.edgeId, [{ room, door, index }]);
      });
    }

    for (const edge of level.edges) {
      const from = graph.nodes.get(edge.a);
      const to = graph.nodes.get(edge.b);
      if (!from || !to) continue; // an edge naming a node that isn't on this level is skipped, not fatal
      const polyline: Point[] = edge.polyline?.length ? edge.polyline : [[from.x, from.y], [to.x, to.y]];
      const doors = (doorsByEdge.get(edge.id) ?? []).slice().sort((a, b) => a.door.t - b.door.t);

      let cursor = from.id;
      let rest = polyline;
      let consumed = 0;
      const total = polylineLength(polyline);
      for (const { room, door, index } of doors) {
        const id = doorNodeId(room.id, index);
        // `t` is measured on the whole edge, so re-base it onto what is left of the line.
        const remaining = total - consumed;
        const local = remaining > 0 ? Math.min(1, Math.max(0, (total * door.t - consumed) / remaining)) : 0;
        const { at, before, after } = splitAt(rest, local);
        node(graph, { id, levelId: level.id, x: at[0], y: at[1], z, kind: "door", roomId: room.id });
        add(graph, {
          id: `${edge.id}:${id}`,
          from: cursor,
          to: id,
          kind: edge.kind,
          access: edge.access,
          accessible: edge.accessible,
          meters: polylineLength(before),
          levels: 0,
          polyline: before,
        });
        graph.roomDoors.set(room.id, [...(graph.roomDoors.get(room.id) ?? []), id]);
        cursor = id;
        rest = after;
        consumed += polylineLength(before);
      }
      add(graph, {
        id: doors.length ? `${edge.id}:end` : edge.id,
        from: cursor,
        to: to.id,
        kind: edge.kind,
        access: edge.access,
        accessible: edge.accessible,
        meters: polylineLength(rest),
        levels: 0,
        polyline: rest,
      });
    }

    // One node per room, reached through its doors. Routes end here so instructions can name the room.
    for (const room of level.rooms) {
      const doorIds = graph.roomDoors.get(room.id) ?? [];
      if (!doorIds.length) continue;
      const id = roomNodeId(room.id);
      const first = graph.nodes.get(doorIds[0]!)!;
      node(graph, { id, levelId: level.id, x: first.x, y: first.y, z, kind: "room", roomId: room.id });
      for (const doorId of doorIds) {
        const d = graph.nodes.get(doorId)!;
        add(graph, {
          id: `${id}<-${doorId}`,
          from: doorId,
          to: id,
          kind: "doorway",
          access: "open",
          accessible: true,
          meters: 0,
          levels: 0,
          polyline: [[d.x, d.y], [d.x, d.y]],
        });
      }
    }
  }

  // Shafts link the same stairwell or elevator across levels, bottom to top.
  const order = new Map(building.levels.map((l) => [l.id, l.sortIndex]));
  for (const shaft of building.shafts) {
    for (let i = 1; i < shaft.nodeIds.length; i++) {
      const a = graph.nodes.get(shaft.nodeIds[i - 1]!);
      const b = graph.nodes.get(shaft.nodeIds[i]!);
      if (!a || !b) continue;
      add(graph, {
        id: `${shaft.id}:${i}`,
        from: a.id,
        to: b.id,
        kind: shaft.kind,
        access: "open",
        accessible: shaft.kind === "elevator",
        meters: 0,
        levels: (order.get(b.levelId) ?? 0) - (order.get(a.levelId) ?? 0),
        polyline: [[a.x, a.y], [b.x, b.y]],
      });
    }
  }

  // Edges the building carries directly (outdoor links, hand-added vertical edges).
  for (const edge of building.edges) {
    const a = graph.nodes.get(edge.a);
    const b = graph.nodes.get(edge.b);
    if (!a || !b) continue;
    const polyline: Point[] = edge.polyline?.length ? edge.polyline : [[a.x, a.y], [b.x, b.y]];
    add(graph, {
      id: edge.id,
      from: a.id,
      to: b.id,
      kind: edge.kind,
      access: edge.access,
      accessible: edge.accessible,
      meters: a.levelId === b.levelId ? polylineLength(polyline) : 0,
      levels: (order.get(b.levelId) ?? 0) - (order.get(a.levelId) ?? 0),
      polyline,
    });
  }

  return graph;
}

export { doorNodeId, roomNodeId };

/** The graph node a route should start or end at, or null with a reason the caller can show. */
export function resolveEndpoint(graph: RouteGraph, endpoint: { type: string; id: string }): { nodeId: string } | { error: string } {
  if (endpoint.type === "node") {
    return graph.nodes.has(endpoint.id) ? { nodeId: endpoint.id } : { error: `no node ${endpoint.id}` };
  }
  if (endpoint.type === "entrance") {
    const entrance = graph.building.entrances.find((e) => e.id === endpoint.id);
    if (!entrance) return { error: `no entrance ${endpoint.id}` };
    return graph.nodes.has(entrance.nodeId) ? { nodeId: entrance.nodeId } : { error: `entrance ${endpoint.id} has no node on the plan` };
  }
  const room = graph.rooms.get(endpoint.id);
  if (!room) return { error: `no room ${endpoint.id}` };
  const id = roomNodeId(room.id);
  if (graph.nodes.has(id)) return { nodeId: id };
  // A room entered through another one arrives at its host's door.
  if (room.enteredVia && graph.nodes.has(roomNodeId(room.enteredVia))) return { nodeId: roomNodeId(room.enteredVia) };
  return { error: `room ${room.number ?? room.id} has no door yet` };
}
