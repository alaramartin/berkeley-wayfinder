import { z } from "zod";
import { Id } from "./primitives";

/** data/raw/<building>/config.yaml. All building-specific knobs live here, not in code. */
export const BuildingConfig = z.object({
  id: Id,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  osmWayId: z.number().int().nullable().default(null),
  defaultFloorHeightM: z.number().positive().default(4.5),
  riserHeightM: z.number().positive().default(0.17),
  levels: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        sortIndex: z.number().int(),
        photo: z.string(),
        verified: z.boolean().default(true),
      }),
    )
    .min(1),
  /** Pipeline class -> legend label(s) printed on the placard. */
  legend: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});
export type BuildingConfig = z.infer<typeof BuildingConfig>;
