import { z } from "zod";
import { Id, Point, Polygon, Polyline } from "./primitives";
import { EdgeKind, NodeKind, RoomCategory, Side } from "./building";

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
  number: z.string().nullable(),
  numberConfidence: Confidence,
  category: RoomCategory,
  polygon: Polygon,
  doors: z.array(z.object({ edgeId: Id, t: z.number().min(0).max(1), side: Side, confidence: Confidence })),
  aliases: z.array(z.string()).default([]),
});
export const ProposalIcon = z.object({
  id: Id,
  kind: z.enum(["exit", "accessible", "dwa", "evac-chair", "you-are-here", "restroom-men", "restroom-women"]),
  at: Point,
  confidence: Confidence,
});

export const Proposal = z.object({
  buildingId: Id,
  levelId: z.string(),
  imageSize: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  generatedAt: z.string(),
  pipelineVersion: z.string(),
  outline: Polygon.nullable(),
  nodes: z.array(ProposalNode),
  edges: z.array(ProposalEdge),
  rooms: z.array(ProposalRoom),
  icons: z.array(ProposalIcon),
});
export type Proposal = z.infer<typeof Proposal>;

export const ReviewItem = z.object({
  id: Id,
  kind: z.enum(["room-number", "alias", "icon", "restroom-gender"]),
  /** Path relative to the level work dir, e.g. review-crops/r012.png */
  crop: z.string(),
  candidates: z.array(z.object({ value: z.string(), confidence: Confidence })),
  targetId: Id,
  resolved: z.object({ value: z.string().nullable(), at: z.string() }).optional(),
});
export const ReviewQueue = z.object({ buildingId: Id, levelId: z.string(), items: z.array(ReviewItem) });
export type ReviewQueue = z.infer<typeof ReviewQueue>;
