"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanZoomHandle {
  /** Client (screen) coordinates -> content coordinates. */
  toContent(clientX: number, clientY: number): [number, number];
  fit(box?: ViewBox): void;
  /** Content units per screen pixel (use to keep markers a constant on-screen size). */
  unitsPerPixel(): number;
}

interface Props {
  width: number;
  height: number;
  children: ReactNode;
  className?: string;
  /** Left-drag on empty space pans (otherwise only middle-drag or space+drag). */
  leftDragPans?: boolean;
  onBackgroundPointerDown?: (e: React.PointerEvent<SVGSVGElement>, at: [number, number]) => void;
  onPointerMove?: (e: React.PointerEvent<SVGSVGElement>, at: [number, number]) => void;
  onViewChange?: (unitsPerPixel: number) => void;
  cursor?: string;
  /** Flip y so content in world meters (y up) displays correctly. */
  flipY?: boolean;
}

/** SVG canvas with wheel zoom (around the cursor) and drag panning. Children draw in content coordinates. */
export const PanZoom = forwardRef<PanZoomHandle, Props>(function PanZoom(
  { width, height, children, className, leftDragPans, onBackgroundPointerDown, onPointerMove, onViewChange, cursor, flipY },
  ref,
) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewBox>({ x: 0, y: 0, w: width, h: height });
  const drag = useRef<{ x: number; y: number; view: ViewBox } | null>(null);
  const space = useRef(false);

  const toContent = useCallback((cx: number, cy: number): [number, number] => {
    const el = svg.current;
    if (!el) return [0, 0];
    const pt = el.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const ctm = el.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = pt.matrixTransform(ctm.inverse());
    return [p.x, flipY ? -p.y : p.y];
  }, [flipY]);

  const unitsPerPixel = useCallback(() => {
    const el = svg.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    return Math.max(view.w / Math.max(1, r.width), view.h / Math.max(1, r.height));
  }, [view]);

  const fit = useCallback((box?: ViewBox) => {
    const b = box ?? { x: 0, y: flipY ? -height : 0, w: width, h: height };
    const pad = 0.03 * Math.max(b.w, b.h);
    setView({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });
  }, [width, height, flipY]);

  useImperativeHandle(ref, () => ({ toContent, fit, unitsPerPixel }), [toContent, fit, unitsPerPixel]);

  useEffect(() => {
    onViewChange?.(unitsPerPixel());
  }, [view, onViewChange, unitsPerPixel]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const pt = el.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = el.getScreenCTM();
      if (!ctm) return;
      const p = pt.matrixTransform(ctm.inverse());
      setView((v) => {
        const w = Math.min(Math.max(v.w * factor, width / 200), width * 20 + 1000);
        const h = (v.h * w) / v.w;
        return { x: p.x - ((p.x - v.x) * w) / v.w, y: p.y - ((p.y - v.y) * h) / v.h, w, h };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [width]);

  return (
    <svg
      ref={svg}
      className={className}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ cursor: drag.current ? "grabbing" : cursor, touchAction: "none" }}
      onPointerDown={(e) => {
        const isBackground = e.target === e.currentTarget || (e.target as Element).getAttribute("data-bg") === "1";
        if (e.button === 1 || space.current || (e.button === 0 && isBackground && leftDragPans)) {
          drag.current = { x: e.clientX, y: e.clientY, view };
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          return;
        }
        if (e.button === 0 && isBackground) onBackgroundPointerDown?.(e, toContent(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => {
        if (drag.current) {
          const d = drag.current;
          const r = svg.current!.getBoundingClientRect();
          const scale = Math.max(d.view.w / r.width, d.view.h / r.height);
          setView({ ...d.view, x: d.view.x - (e.clientX - d.x) * scale, y: d.view.y - (e.clientY - d.y) * scale });
          return;
        }
        onPointerMove?.(e, toContent(e.clientX, e.clientY));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <g transform={flipY ? "scale(1,-1)" : undefined}>{children}</g>
    </svg>
  );
});
