import { z } from "zod";

/** [x, y]. Meters in the building-local frame (canonical) or pixels (proposals). */
export const Point = z.tuple([z.number(), z.number()]);
export type Point = z.infer<typeof Point>;

export const Polygon = z.array(Point).min(3);
export type Polygon = z.infer<typeof Polygon>;

export const Polyline = z.array(Point).min(2);
export type Polyline = z.infer<typeof Polyline>;

/** Similarity transform: p' = scale * R(rotation) * p + [tx, ty]. Rotation in radians. */
export const Similarity = z.object({
  scale: z.number().positive(),
  rotation: z.number(),
  tx: z.number(),
  ty: z.number(),
});
export type Similarity = z.infer<typeof Similarity>;

export const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
export type LatLon = z.infer<typeof LatLon>;

/** Stable readable IDs, e.g. wheeler-L1-n012, wheeler-shaft-s1. */
export const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/, "ids are kebab-case alphanumerics");
