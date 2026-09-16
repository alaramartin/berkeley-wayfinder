import { z } from "zod";
import { Access, Side } from "./building";
import { Id, Point } from "./primitives";

/** Field-walk edits exported from /field and imported (with review) by the author tool. */
export const PatchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("confirmDoor"), roomId: Id, doorIndex: z.number().int().nonnegative() }),
  z.object({
    op: z.literal("moveDoor"),
    roomId: Id,
    doorIndex: z.number().int().nonnegative(),
    edgeId: Id,
    t: z.number().min(0).max(1),
    side: Side,
  }),
  z.object({ op: z.literal("addDoor"), roomId: Id, edgeId: Id, t: z.number().min(0).max(1), side: Side }),
  z.object({ op: z.literal("setRoomNumber"), roomId: Id, number: z.string() }),
  z.object({ op: z.literal("setEdgeAccess"), edgeId: Id, access: Access }),
  z.object({ op: z.literal("setStepCount"), shaftId: Id, index: z.number().int().nonnegative(), steps: z.number().int().nonnegative() }),
  z.object({ op: z.literal("confirmEntrance"), entranceId: Id, accessible: z.boolean() }),
  z.object({ op: z.literal("note"), levelId: z.string(), at: Point.optional(), text: z.string() }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const Patch = z.object({
  buildingId: Id,
  /** Hash of the canonical data the edits were made against. */
  baseHash: z.string(),
  createdAt: z.string(),
  author: z.string().optional(),
  ops: z.array(PatchOp),
});
export type Patch = z.infer<typeof Patch>;
