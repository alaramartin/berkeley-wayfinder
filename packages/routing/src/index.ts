/**
 * Routing over canonical building data. Pure TS: no DOM, no three.
 * Implemented in M3 (graph build with virtual door nodes, A*, nearest-POI, instructions). See PLAN.md §7.
 */
export type Endpoint =
  | { type: "room"; id: string }
  | { type: "entrance"; id: string }
  | { type: "node"; id: string };

export interface RouteOptions {
  /** Exclude stairs and non-accessible entrances. */
  accessible: boolean;
}

/** Walking speed used for time estimates, m/s. */
export const WALK_SPEED_MPS = 1.3;
