/** All app state lives in the URL, so any view can be shared as a link. */
import type { PoiKind } from "@wf/schema";

export type ViewMode = "exploded" | "solid";

export interface NavState {
  /** Room id, entrance id, or null. */
  from: string | null;
  to: string | null;
  /** "nearest restroom" style destination, resolved against `from`. */
  nearest: PoiKind | null;
  accessible: boolean;
  view: ViewMode;
  /** Level the camera is focused on, if any. */
  level: string | null;
}

export const DEFAULT_STATE: NavState = { from: null, to: null, nearest: null, accessible: false, view: "exploded", level: null };

export function readState(params: URLSearchParams): NavState {
  const view = params.get("view");
  return {
    from: params.get("from"),
    to: params.get("to"),
    nearest: (params.get("nearest") as PoiKind | null) ?? null,
    accessible: params.get("accessible") === "1",
    view: view === "solid" ? "solid" : "exploded",
    level: params.get("level"),
  };
}

/** Only non-default values are written, so shared links stay short. */
export function writeState(state: NavState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.nearest) params.set("nearest", state.nearest);
  if (state.accessible) params.set("accessible", "1");
  if (state.view !== DEFAULT_STATE.view) params.set("view", state.view);
  if (state.level) params.set("level", state.level);
  return params;
}
