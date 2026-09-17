import { z } from "zod";
import { Id, Point, Polygon, Polyline } from "./primitives";
import { EdgeKind, NodeKind, Restroom, RoomCategory, Side } from "./building";

/** Pipeline output. Same concepts as canonical data, but in rectified-image pixels and with confidences. */
const Confidence = z.number().min(0).max(1);

export const ProposalNode = z.object({ id: Id, x: z.number(), y: z.number(), kind: NodeKind, confidence: Confidence });
export const ProposalEdge = z.object({
  id: Id,
  a: Id,
  b: Id,
  kind: EdgeKind,
  polyline: Polyline,
  confidence: Confidence,
});
export const ProposalRoom = z.object({
  id: Id,
  /** Pipeline region the polygon came from; rooms sharing a region are one suite. */
  regionId: Id.optional(),
  number: z.string().nullable(),
  name: z.string().optional(),
  numberConfidence: Confidence,
  category: RoomCategory,
  group: z.string().nullable(),
  polygon: Polygon,
  doors: z.array(z.object({ edgeId: Id, t: z.number().min(0).max(1), side: Side, confidence: Confidence })),
  aliases: z.array(z.string()).default([]),
  restroom: Restroom.optional(),
});
export type ProposalRoom = z.infer<typeof ProposalRoom>;
export const ProposalEntrance = z.object({
  id: Id,
  nodeId: Id,
  name: z.string().optional(),
  accessible: z.boolean(),
  /** What suggested it: an exit sign, an accessibility icon, or a corridor reaching the facade. */
  evidence: z.array(z.enum(["exit-icon", "accessible-icon", "corridor-end"])),
  confidence: Confidence,
});
export const ProposalIcon = z.object({
  id: Id,
  kind: z.enum([
    "exit",
    "accessible",
    "gender-inclusive-restroom",
    "dwa",
    "evac-chair",
    "you-are-here",
    "restroom-men",
    "restroom-women",
  ]),
  at: Point,
  confidence: Confidence,
});

export const Proposal = z.object({
  buildingId: Id,
  levelId: z.string(),
  imageSize: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  generatedAt: z.string(),
  /** Set by the author tool on first save; the pipeline then writes proposal.auto.json instead of overwriting. */
  editedAt: z.string().optional(),
  pipelineVersion: z.string(),
  outline: Polygon.nullable(),
  /** Courtyards and multi-level voids inside the outline. */
  voids: z.array(Polygon).default([]),
  nodes: z.array(ProposalNode),
  edges: z.array(ProposalEdge),
  rooms: z.array(ProposalRoom),
  icons: z.array(ProposalIcon),
  entrances: z.array(ProposalEntrance).default([]),
  /** Name -> room number pairs read from a directory panel (e.g. Wheeler L1 lists every level). */
  directory: z
    .array(z.object({ name: z.string(), room: z.string(), confidence: Confidence }))
    .default([]),
});
export type Proposal = z.infer<typeof Proposal>;
export type ProposalNode = z.infer<typeof ProposalNode>;
export type ProposalEdge = z.infer<typeof ProposalEdge>;
export type ProposalIcon = z.infer<typeof ProposalIcon>;
export type ProposalEntrance = z.infer<typeof ProposalEntrance>;

export const ReviewItem = z.object({
  id: Id,
  kind: z.enum(["room-number", "alias", "icon", "restroom-gender"]),
  /** Path relative to the level work dir, e.g. review-crops/r012.png */
  crop: z.string(),
  candidates: z.array(z.object({ value: z.string(), confidence: Confidence })),
  targetId: Id,
  resolved: z.object({ value: z.string().nullable(), at: z.string() }).optional(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;
export const ReviewQueue = z.object({ buildingId: Id, levelId: z.string(), items: z.array(ReviewItem) });
export type ReviewQueue = z.infer<typeof ReviewQueue>;
