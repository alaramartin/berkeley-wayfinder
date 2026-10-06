"use client";
/**
 * On-screen camera controls. A remapped gesture scheme is unfamiliar, and the trackpad/mouse guess can
 * be wrong, so zoom and a way back to the overview are always reachable without gestures.
 */
import { ArrowsClockwise, ArrowsOut, HandGrabbing, Minus, Plus, Question } from "@phosphor-icons/react";
import { useState } from "react";

export function ViewControls({
  onZoomIn,
  onZoomOut,
  onOverview,
  turnMode,
  onTurnMode,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOverview: () => void;
  turnMode: boolean;
  onTurnMode: (on: boolean) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const button = "flex size-10 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow backdrop-blur hover:bg-white";

  return (
    <div className="absolute bottom-4 right-3 select-none flex flex-col items-end gap-2 pb-[env(safe-area-inset-bottom)]">
      {helpOpen && (
        <div className="mb-1 w-60 rounded-xl bg-white/95 p-3 text-xs text-neutral-700 shadow-lg backdrop-blur">
          <p className="mb-2 font-medium text-neutral-900">Moving around</p>
          <ul className="space-y-1">
            <li>
              <strong>Drag</strong> — move the building, up, down and sideways (one finger on a phone)
            </li>
            <li>
              <strong>Turn button</strong> (the round arrows), or Shift-drag, or right-drag — turn and tip the building
            </li>
            <li>
              <strong>Two fingers</strong> — swipe to turn, pinch to zoom
            </li>
            <li>
              <strong>Scroll or pinch</strong> — zoom; on a trackpad a two-finger swipe moves
            </li>
            <li>
              <strong>Double-tap</strong> — zoom in on that spot
            </li>
          </ul>
        </div>
      )}
      <button className={button} aria-label="How to move around" onClick={() => setHelpOpen((open) => !open)}>
        <Question size={18} />
      </button>
      <button
        className={`${button} ${turnMode ? "!bg-neutral-900 !text-white" : ""}`}
        aria-label={turnMode ? "Dragging turns the building. Press to move it instead" : "Dragging moves the building. Press to turn it instead"}
        aria-pressed={turnMode}
        title={turnMode ? "Dragging turns the building" : "Dragging moves the building"}
        onClick={() => onTurnMode(!turnMode)}
      >
        {turnMode ? <ArrowsClockwise size={18} /> : <HandGrabbing size={18} />}
      </button>
      <button className={button} aria-label="Show the whole building" onClick={onOverview}>
        <ArrowsOut size={18} />
      </button>
      <button className={button} aria-label="Zoom in" onClick={onZoomIn}>
        <Plus size={18} />
      </button>
      <button className={button} aria-label="Zoom out" onClick={onZoomOut}>
        <Minus size={18} />
      </button>
    </div>
  );
}
