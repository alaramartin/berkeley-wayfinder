"use client";
/**
 * A flat plan of one level for the walk: rooms, corridors, doors, entrances and stairs, big enough
 * to tap with a thumb. Pan with a finger, pinch to zoom, tap to select. SVG rather than the 3D view:
 * it is quick, readable in sunlight and cheap on a phone's battery.
 */
import { interiorPoint } from "@wf/geometry";
import type { Level, Point } from "@wf/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type FieldView, type Selection, doorPoints } from "@/lib/field/model";
import { CATEGORY_COLOR } from "@/lib/scene";

/** SVG's y runs down and the building's runs north, so every point is flipped on the way in. */
const sv = (p: Point): string => `${p[0]},${-p[1]}`;
const path = (poly: Point[]): string => `M${poly.map(sv).join("L")}Z`;

interface Box {
  x: number;
  y: number;
  w: number;
}

function boundsOf(level: Level): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = level.outline.length ? level.outline : level.rooms.flatMap((r) => r.polygon);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function FieldMap({
  view,
  level,
  selection,
  highlight,
  focus,
  onTap,
}: {
  view: FieldView;
  level: Level;
  selection: Selection | null;
  /** A spot to ring while placing a door. */
  highlight: Point | null;
  /** Centre on this point when `key` changes. */
  focus: { point: Point; key: number } | null;
  onTap: (point: Point, reachM: number) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: 100 });

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const read = () => setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    const b = boundsOf(level);
    const width = Math.max(b.maxX - b.minX, ((b.maxY - b.minY) * size.w) / size.h) * 1.08;
    setBox({ x: (b.minX + b.maxX) / 2 - width / 2, y: -(b.maxY + b.minY) / 2 - (width * size.h) / size.w / 2, w: width });
  }, [level, size.w, size.h]);

  // Fit when the level changes (and once the container has a real size).
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    const key = `${level.id}:${size.w > 100}`;
    if (fitted.current === key) return;
    fitted.current = key;
    fit();
  }, [level.id, size.w, fit]);

  useEffect(() => {
    if (!focus) return;
    setBox((b) => {
      const w = Math.min(b.w, 40);
      return { x: focus.point[0] - w / 2, y: -focus.point[1] - (w * size.h) / size.w / 2, w };
    });
    // Only when asked: `focus.key` changes, not its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  const mpp = box.w / size.w;
  const boxH = (box.w * size.h) / size.w;
  const toWorld = (clientX: number, clientY: number): Point => {
    const r = holder.current!.getBoundingClientRect();
    return [box.x + ((clientX - r.left) / size.w) * box.w, -(box.y + ((clientY - r.top) / size.h) * boxH)];
  };

  // Gestures: one pointer pans, two pinch, a short still press is a tap.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: Box; centre: { x: number; y: number }; spread: number; moved: boolean; at: number } | null>(null);

  const begin = () => {
    const pts = [...pointers.current.values()];
    const centre = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const spread = pts.length > 1 ? Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y) : 0;
    gesture.current = { start: box, centre, spread, moved: gesture.current?.moved ?? false, at: gesture.current?.at ?? performance.now() };
  };

  const zoomAbout = (b: Box, factor: number, px: number, py: number): Box => {
    const w = Math.min(600, Math.max(6, b.w * factor));
    const k = w / b.w;
    const wx = b.x + (px / size.w) * b.w;
    const wy = b.y + (py / size.h) * ((b.w * size.h) / size.w);
    return { x: wx - (px / size.w) * w, y: wy - (py / size.h) * ((w * size.h) / size.w), w: b.w * k };
  };

  return (
    <div
      ref={holder}
      className="relative size-full touch-none select-none overflow-hidden bg-neutral-100"
      onPointerDown={(e) => {
        // Let the zoom buttons receive their own clicks.
        if ((e.target as HTMLElement).closest("button")) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 1) gesture.current = null;
        begin();
        if (pointers.current.size > 1 && gesture.current) gesture.current.moved = true;
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || !pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pts = [...pointers.current.values()];
        const centre = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
        if (!g.moved && Math.hypot(centre.x - g.centre.x, centre.y - g.centre.y) < 6) return;
        g.moved = true;
        const r = holder.current!.getBoundingClientRect();
        let next = g.start;
        if (pts.length > 1 && g.spread > 0) {
          const spread = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
          next = zoomAbout(next, g.spread / Math.max(1, spread), g.centre.x - r.left, g.centre.y - r.top);
        }
        // The point under the fingers stays under them.
        const m = next.w / size.w;
        setBox({ ...next, x: next.x - (centre.x - g.centre.x) * m, y: next.y - (centre.y - g.centre.y) * m });
      }}
      onPointerUp={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        const g = gesture.current;
        pointers.current.delete(e.pointerId);
        if (pointers.current.size > 0) {
          begin();
          return;
        }
        gesture.current = null;
        if (g && !g.moved && performance.now() - g.at < 500) {
          const p = toWorld(e.clientX, e.clientY);
          onTap(p, Math.max(0.9, 18 * mpp));
        }
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        gesture.current = null;
      }}
      onWheel={(e) => {
        const r = holder.current!.getBoundingClientRect();
        setBox((b) => zoomAbout(b, Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top));
      }}
    >
      <svg width={size.w} height={size.h} viewBox={`${box.x} ${box.y} ${box.w} ${boxH}`} className="block">
        <FieldLayers view={view} level={level} selection={selection} highlight={highlight} mpp={mpp} />
      </svg>
      <div className="absolute right-2 top-2 flex flex-col gap-2">
        <button aria-label="Zoom in" className="size-10 rounded-full bg-white text-xl shadow" onClick={() => setBox((b) => zoomAbout(b, 0.6, size.w / 2, size.h / 2))}>
          +
        </button>
        <button aria-label="Zoom out" className="size-10 rounded-full bg-white text-xl shadow" onClick={() => setBox((b) => zoomAbout(b, 1.6, size.w / 2, size.h / 2))}>
          −
        </button>
        <button aria-label="Fit the whole level" className="size-10 rounded-full bg-white text-xs shadow" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}

function FieldLayers({ view, level, selection, highlight, mpp }: { view: FieldView; level: Level; selection: Selection | null; highlight: Point | null; mpp: number }) {
  const doors = useMemo(() => doorPoints(level), [level]);
  const nodes = useMemo(() => new Map(level.nodes.map((n) => [n.id, n])), [level]);
  const labels = useMemo(() => level.rooms.filter((r) => r.number && !r.enteredVia).map((r) => ({ id: r.id, text: r.number!, at: interiorPoint(r.polygon) })), [level]);
  const px = (n: number) => n * mpp;
  const selectedRoom = selection && (selection.kind === "door" || selection.kind === "room") ? selection.roomId : null;
  const selectedEdge = selection?.kind === "edge" ? selection.edgeId : null;

  return (
    <>
      <path d={[level.outline, ...level.voids].map(path).join("")} fill="#fff" fillRule="evenodd" stroke="#475569" strokeWidth={px(1.5)} />
      {level.rooms.map((r) => (
        <path
          key={r.id}
          d={path(r.polygon)}
          fill={CATEGORY_COLOR[r.category] ?? CATEGORY_COLOR.other}
          fillOpacity={r.id === selectedRoom ? 0.75 : 0.4}
          stroke={r.id === selectedRoom ? "#0f172a" : "#fff"}
          strokeWidth={px(r.id === selectedRoom ? 2.5 : 1)}
        />
      ))}
      {level.edges
        .filter((e) => e.polyline && e.kind === "corridor")
        .map((e) => (
          <polyline
            key={e.id}
            points={e.polyline!.map(sv).join(" ")}
            fill="none"
            stroke={e.id === selectedEdge ? "#2563eb" : e.access && e.access !== "open" ? "#b45309" : "#94a3b8"}
            strokeWidth={px(e.id === selectedEdge ? 4 : 2)}
            strokeDasharray={e.access && e.access !== "open" ? `${px(6)} ${px(4)}` : undefined}
            strokeLinecap="round"
          />
        ))}
      {mpp < 0.35 &&
        labels.map((l) => (
          <text key={l.id} x={l.at[0]} y={-l.at[1]} fontSize={px(11)} textAnchor="middle" dominantBaseline="middle" fill="#0f172a" style={{ pointerEvents: "none" }}>
            {l.text}
          </text>
        ))}
      {view.building.entrances.map((e) => {
        const n = nodes.get(e.nodeId);
        if (!n) return null;
        const s = px(9);
        return (
          <g key={e.id}>
            <rect x={n.x - s} y={-n.y - s} width={s * 2} height={s * 2} fill={e.verified ? "#16a34a" : "#f59e0b"} stroke="#fff" strokeWidth={px(2)} />
            <text x={n.x} y={-n.y - s * 1.6} fontSize={px(10)} textAnchor="middle" fill="#0f172a" style={{ pointerEvents: "none" }}>
              {e.name}
            </text>
          </g>
        );
      })}
      {view.building.shafts.map((shaft) =>
        shaft.nodeIds.map((id) => {
          const n = nodes.get(id);
          if (!n) return null;
          const s = px(9);
          const lift = shaft.kind === "elevator";
          return (
            <g key={`${shaft.id}-${id}`}>
              <circle cx={n.x} cy={-n.y} r={s} fill={lift ? "#f97316" : "#22c55e"} stroke="#fff" strokeWidth={px(2)} />
              <text x={n.x} y={-n.y} fontSize={px(10)} textAnchor="middle" dominantBaseline="central" fill="#fff" style={{ pointerEvents: "none" }}>
                {lift ? "L" : "S"}
              </text>
            </g>
          );
        }),
      )}
      {doors.map((d) => {
        const isSelected = selection?.kind === "door" && selection.roomId === d.roomId && selection.doorIndex === d.doorIndex;
        return (
          <circle
            key={`${d.roomId}-${d.doorIndex}`}
            cx={d.point[0]}
            cy={-d.point[1]}
            r={px(isSelected ? 10 : 7)}
            fill={d.verified ? "#16a34a" : "#f59e0b"}
            stroke={isSelected ? "#0f172a" : "#fff"}
            strokeWidth={px(isSelected ? 3 : 2)}
          />
        );
      })}
      {highlight && <circle cx={highlight[0]} cy={-highlight[1]} r={px(14)} fill="none" stroke="#2563eb" strokeWidth={px(3)} />}
    </>
  );
}
