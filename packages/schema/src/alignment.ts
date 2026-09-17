import { z } from "zod";
import { Id, LatLon, Point, Similarity } from "./primitives";

/** A clicked correspondence: `src` on the level being aligned, `dst` on the target. */
export const AnchorPair = z.object({ src: Point, dst: Point });
export type AnchorPair = z.infer<typeof AnchorPair>;

export const LevelAlignment = z.object({
  /** Quarter-turn applied before anchor picking, only to make matching easier on screen. */
  rotationHint: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  anchors: z.array(AnchorPair).default([]),
  /** Level rectified px -> reference level rectified px (image coordinates). Identity for the reference. */
  transform: Similarity.nullable(),
  rms: z.number().nullable(),
});
export type LevelAlignment = z.infer<typeof LevelAlignment>;

export const OsmFit = z.object({
  wayId: z.number().int().nullable(),
  /** Lat/lon of the local frame origin (footprint centroid). */
  origin: LatLon.nullable(),
  /** src: reference-level px, dst: local meters (x east, y north). */
  anchors: z.array(AnchorPair).default([]),
  /** Applied to (x, -y) of reference-level px -> local meters. */
  transform: Similarity.nullable(),
  rms: z.number().nullable(),
});
export type OsmFit = z.infer<typeof OsmFit>;

/** data/work/<building>/alignment.json: authoring state for putting every level in one world frame. */
export const Alignment = z.object({
  buildingId: Id,
  referenceLevel: z.string(),
  levels: z.record(z.string(), LevelAlignment),
  osm: OsmFit,
});
export type Alignment = z.infer<typeof Alignment>;
