"use client";
/**
 * On-screen camera controls. A remapped gesture scheme is unfamiliar, and the trackpad/mouse guess can
 * be wrong, so zoom and a way back to the overview are always reachable without gestures.
 */
import { ArrowsOut, Minus, Plus, Question } from "@phosphor-icons/react";
import { useState } from "react";
import type { PointerDevice } from "@/lib/input";

export function ViewControls({
  onZoomIn,
  onZoomOut,
  onOverview,
  device,
  onDevice,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOverview: () => void;
  device: PointerDevice;
  onDevice: (d: PointerDevice) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const button = "flex size-10 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow backdrop-blur hover:bg-white";

  return (
    <div className="absolute bottom-4 right-3 flex flex-col items-end gap-2 pb-[env(safe-area-inset-bottom)]">
      {helpOpen && (
        <div className="mb-1 w-60 rounded-xl bg-white/95 p-3 text-xs text-neutral-700 shadow-lg backdrop-blur">
          <p className="mb-2 font-medium text-neutral-900">Moving around</p>
          <ul className="space-y-1">
            <li>
              <strong>Drag</strong> — turn the building around the spot you grab
            </li>
            <li>
              <strong>Two-finger swipe</strong> — slide it
            </li>
            <li>
              <strong>Pinch or scroll</strong> — zoom
            </li>
            <li>
              <strong>Right-drag</strong> — slide it, with a mouse
            </li>
          </ul>
          <p className="mb-1 mt-3 font-medium text-neutral-900">If scrolling does the wrong thing</p>
          <div className="flex overflow-hidden rounded-full border border-neutral-300">
            {(["auto", "trackpad", "mouse"] as const).map((option) => (
              <button
                key={option}
                onClick={() => onDevice(option)}
                aria-pressed={device === option}
                className={`flex-1 px-2 py-1 capitalize ${device === option ? "bg-neutral-900 text-white" : "text-neutral-700"}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className={button} aria-label="How to move around" onClick={() => setHelpOpen((open) => !open)}>
        <Question size={18} />
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
