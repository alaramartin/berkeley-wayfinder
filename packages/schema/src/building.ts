import { z } from "zod";
import { Id, LatLon, Point, Polygon, Polyline, Similarity } from "./primitives";

export const HeightSource = z.enum(["default", "stair-count", "measured"]);

export const NodeKind = z.enum(["junction", "door", "stair", "elevator", "entrance"]);
export const Node = z.object({
  id: Id,
  levelId: z.string(),
  x: z.number(),
  y: z.number(),
  kind: NodeKind,
  verified: z.boolean().default(false),
});
export type Node = z.infer<typeof Node>;

export const EdgeKind = z.enum(["corridor", "stair", "elevator", "outdoor"]);
export const Access = z.enum(["open", "card", "hours", "locked"]);
export const Edge = z.object({
  id: Id,
  a: Id,
  b: Id,
  kind: EdgeKind,
  polyline: Polyline.optional(),
  accessible: z.boolean(),
  access: Access.default("open"),
  verified: z.boolean().default(false),
});
export type Edge = z.infer<typeof Edge>;

export const Side = z.enum(["left", "right"]);
export const Door = z.object({
  edgeId: Id,
  t: z.number().min(0).max(1),
  /** Side of the edge the room is on, walking a -> b. */
  side: Side,
  verified: z.boolean().default(false),
});
export type Door = z.infer<typeof Door>;

export const RoomCategory = z.enum([
  "classroom",
  "computer-lab",
  "seminar",
  "library",
  "office",
  "restroom",
  "lactation",
  "auditorium",
  "stair",
  "elevator",
  "service", // gray on placards: mechanical, storage, not publicly accessible
  "other",
]);
export const Restroom = z.object({ gender: z.enum(["men", "women", "all"]), accessible: z.boolean() });

export type RoomCategory = z.infer<typeof RoomCategory>;
export type NodeKind = z.infer<typeof NodeKind>;
export type EdgeKind = z.infer<typeof EdgeKind>;
export type Restroom = z.infer<typeof Restroom>;

export const Room = z
  .object({
    id: Id,
    /** Null for rooms placards don't number (restrooms); those need a name. */
    number: z.string().nullable(),
    name: z.string().optional(),
    aliases: z.array(z.string()).default([]),
    category: RoomCategory,
    /** Legend label the room's color maps to on the placard, e.g. "English Department Library". */
    group: z.string().optional(),
    levelId: z.string(),
    polygon: Polygon,
    doors: z.array(Door).default([]),
    /** Room this one is entered through (its `id`), when it has no door of its own onto a corridor. */
    enteredVia: Id.optional(),
    restroom: Restroom.optional(),
  })
  .refine((r) => r.number !== null || (r.name !== undefined && r.name.length > 0), "a room needs a number or a name");
export type Room = z.infer<typeof Room>;

export const Shaft = z.object({
  id: Id,
  kind: z.enum(["stair", "elevator"]),
  name: z.string().optional(),
  /** Ordered bottom to top. */
  nodeIds: z.array(Id).min(2),
  /** Steps between consecutive nodeIds (length nodeIds.length - 1), from the field walk. */
  stepCounts: z.array(z.number().int().nonnegative().nullable()).optional(),
});
export type Shaft = z.infer<typeof Shaft>;

export const Entrance = z.object({
  id: Id,
  nodeId: Id,
  name: z.string(),
  accessible: z.boolean(),
  verified: z.boolean().default(false),
});
export type Entrance = z.infer<typeof Entrance>;

export const PoiKind = z.enum([
  "restroom",
  "accessible-restroom",
  "gender-inclusive-restroom",
  "lactation",
  "elevator",
  "evac-chair",
  "dwa",
  "exit",
]);
export const Poi = z
  .object({
    id: Id,
    kind: PoiKind,
    levelId: z.string(),
    nodeId: Id.optional(),
    roomId: Id.optional(),
  })
  .refine((p) => p.nodeId !== undefined || p.roomId !== undefined, "poi needs nodeId or roomId");
export type Poi = z.infer<typeof Poi>;

export const Level = z.object({
  id: z.string(),
  buildingId: Id,
  sortIndex: z.number().int(),
  displayName: z.string(),
  elevationM: z.number(),
  heightM: z.number().positive(),
  heightSource: HeightSource,
  verified: z.boolean().default(false),
  outline: Polygon,
  voids: z.array(Polygon).default([]),
  /** Rectified-image pixels -> building-local meters. */
  imageTransform: Similarity,
  nodes: z.array(Node),
  edges: z.array(Edge),
  rooms: z.array(Room),
  pois: z.array(Poi).default([]),
});
export type Level = z.infer<typeof Level>;

export const LevelRef = z.object({ id: z.string(), sortIndex: z.number().int() });

export const Building = z.object({
  id: Id,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  osmWayId: z.number().int().nullable(),
  /** Lat/lon of the local frame origin (footprint centroid). Null until the OSM fit. */
  origin: LatLon.nullable(),
  footprint: z.array(Point),
  levels: z.array(LevelRef),
  shafts: z.array(Shaft).default([]),
  /** Vertical (stair/elevator) and outdoor edges that span levels. */
  edges: z.array(Edge).default([]),
  entrances: z.array(Entrance).default([]),
});
export type Building = z.infer<typeof Building>;
