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
        /** Regex room numbers on this level must match to be auto-accepted, e.g. "^2\\d\\d[A-Z]?$". */
        roomPattern: z.string().optional(),
      }),
    )
    .min(1),
  /**
   * Extra legend-label -> category rules, checked before the pipeline's generic defaults.
   * Matching is case-insensitive substring. Legends are read per placard, so no per-level config is needed.
   */
  categoryRules: z.array(z.object({ match: z.string(), category: z.string() })).default([]),
});
export type BuildingConfig = z.infer<typeof BuildingConfig>;
