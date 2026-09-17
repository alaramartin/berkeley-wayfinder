"use client";
import { useCallback, useState } from "react";

export interface History<T> {
  present: T;
  canUndo: boolean;
  canRedo: boolean;
  /** Push a new state (clears redo). */
  commit(next: T): void;
  /** Replace the present without a history entry (e.g. while dragging). */
  preview(next: T): void;
  /** Replace everything (after loading). */
  reset(next: T): void;
  undo(): void;
  redo(): void;
}

export function useHistory<T>(initial: T, limit = 200): History<T> {
  const [state, setState] = useState<{ past: T[]; present: T; future: T[]; base: T }>({ past: [], present: initial, future: [], base: initial });
  const commit = useCallback(
    (next: T) => setState((s) => ({ past: [...s.past, s.base].slice(-limit), present: next, future: [], base: next })),
    [limit],
  );
  const preview = useCallback((next: T) => setState((s) => ({ ...s, present: next })), []);
  const reset = useCallback((next: T) => setState({ past: [], present: next, future: [], base: next }), []);
  const undo = useCallback(
    () => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past.at(-1)!, base: s.past.at(-1)!, future: [s.base, ...s.future] } : s)),
    [],
  );
  const redo = useCallback(
    () => setState((s) => (s.future.length ? { past: [...s.past, s.base], present: s.future[0]!, base: s.future[0]!, future: s.future.slice(1) } : s)),
    [],
  );
  return { present: state.present, canUndo: state.past.length > 0, canRedo: state.future.length > 0, commit, preview, reset, undo, redo };
}
