"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, ArrowCounterClockwise, MagicWand, Trash } from "@phosphor-icons/react";
import { apply, invert } from "@wf/geometry";
import type { Alignment, AnchorPair, Point, Proposal } from "@wf/schema";
import { autoAlign, fromAnchors, residuals, rotateAbout, svgMatrix, type AutoAlignResult } from "@/lib/align";
import { api, fileUrl } from "@/lib/client";
import { centroid } from "@/lib/polygon";
import { PanZoom, type PanZoomHandle } from "@/components/PanZoom";

export function Align({ building }: { building: string }) {
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [level, setLevel] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.5);
  const [pendingSrc, setPendingSrc] = useState<Point | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<AutoAlignResult["candidates"]>([]);
  const [upp, setUpp] = useState(2);
  const canvas = useRef<PanZoomHandle>(null);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      const summary = await api.building(building);
      const entries = await Promise.all(summary.levels.filter((l) => l.hasProposal).map(async (l) => [l.id, await api.proposal(building, l.id)] as const));
      setProposals(Object.fromEntries(entries));
      setAlignment(summary.alignment);
      setLevel(summary.levels.find((l) => l.id !== summary.alignment.referenceLevel)?.id ?? null);
    })().catch((e: Error) => setMessage(e.message));
  }, [building]);

  useEffect(() => {
    if (!alignment) return;
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    const t = setTimeout(() => api.saveAlignment(building, alignment).catch((e: Error) => setMessage(`save failed: ${e.message}`)), 500);
    return () => clearTimeout(t);
  }, [alignment, building]);

  const ref = alignment ? proposals[alignment.referenceLevel] : undefined;
  const moving = level ? proposals[level] : undefined;
  const state = alignment && level ? alignment.levels[level] : undefined;
  const transform = state?.transform ?? null;

  const stairs = (p: Proposal | undefined) => (p ? p.nodes.filter((n) => n.kind === "stair" || n.kind === "elevator") : []);
  const refStairs = useMemo(() => stairs(ref), [ref]);
  const movedStairs = useMemo(() => (transform && moving ? stairs(moving).map((n) => ({ kind: n.kind, at: apply(transform, [n.x, n.y]) })) : []), [transform, moving]);

  if (message && !alignment) return <p className="p-6 text-red-700">{message}</p>;
  if (!alignment || !ref) return <p className="p-6 text-neutral-500">Loading…</p>;
  const [W, H] = ref.imageSize;
  const r = (px: number) => px * upp;

  function update(levelId: string, patch: Partial<Alignment["levels"][string]>) {
    setAlignment((a) => (a ? { ...a, levels: { ...a.levels, [levelId]: { rotationHint: 0, anchors: [], transform: null, rms: null, ...a.levels[levelId], ...patch } } } : a));
  }

  function setAnchors(anchors: AnchorPair[]) {
    if (!level) return;
    const fit = fromAnchors(anchors);
    update(level, fit ? { anchors, transform: fit.transform, rms: fit.rms } : { anchors });
  }

  function onClick(at: Point) {
    if (!level || !moving) return;
    if (!transform) return setMessage("Run Auto-align (or rotate) first so the level is on screen, then refine with anchors.");
    if (!pendingSrc) {
      // A point on the overlay: convert back to the moving level's own pixels.
      setPendingSrc(apply(invert(transform), at));
      setMessage("Now click the same feature on the reference level.");
    } else {
      setAnchors([...(state?.anchors ?? []), { src: pendingSrc, dst: at }]);
      setPendingSrc(null);
      setMessage(null);
    }
  }

  const levelIds = Object.keys(proposals).filter((id) => id !== alignment.referenceLevel);

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1 bg-neutral-800">
        <PanZoom ref={canvas} width={W} height={H} className="h-full w-full" cursor="crosshair" onViewChange={setUpp} onBackgroundPointerDown={(_e, at) => onClick(at)}>
          <rect x={0} y={0} width={W} height={H} fill="#fff" data-bg="1" />
          <image href={fileUrl(building, alignment.referenceLevel, "rectified.jpg")} width={W} height={H} data-bg="1" opacity={0.9} style={{ pointerEvents: "none" }} />
          {ref.outline && <polygon points={pts(ref.outline)} fill="none" stroke="#2563eb" strokeWidth={r(2)} pointerEvents="none" />}
          {moving && transform && level && (
            <g transform={svgMatrix(transform)} pointerEvents="none">
              <image href={fileUrl(building, level, "rectified.jpg")} width={moving.imageSize[0]} height={moving.imageSize[1]} opacity={opacity} />
              {moving.outline && <polygon points={pts(moving.outline)} fill="none" stroke="#ea580c" strokeWidth={r(2) / transform.scale} />}
            </g>
          )}
          {refStairs.map((n) => (
            <circle key={n.id} cx={n.x} cy={n.y} r={r(6)} fill="none" stroke={n.kind === "stair" ? "#16a34a" : "#f59e0b"} strokeWidth={r(2.5)} pointerEvents="none" />
          ))}
          {movedStairs.map((n, i) => (
            <rect key={i} x={n.at[0] - r(5)} y={n.at[1] - r(5)} width={r(10)} height={r(10)} fill={n.kind === "stair" ? "#16a34a" : "#f59e0b"} pointerEvents="none" />
          ))}
          {(state?.anchors ?? []).map((a, i) => {
            const src = transform ? apply(transform, a.src) : a.src;
            return (
              <g key={i} pointerEvents="none">
                <line x1={src[0]} y1={src[1]} x2={a.dst[0]} y2={a.dst[1]} stroke="#db2777" strokeWidth={r(2)} />
                <circle cx={a.dst[0]} cy={a.dst[1]} r={r(5)} fill="#db2777" />
                <text x={a.dst[0] + r(8)} y={a.dst[1]} fontSize={r(14)} fill="#db2777" fontWeight={700}>
                  {i + 1}
                </text>
              </g>
            );
          })}
          {pendingSrc && transform && (
            <circle cx={apply(transform, pendingSrc)[0]} cy={apply(transform, pendingSrc)[1]} r={r(7)} fill="none" stroke="#db2777" strokeWidth={r(3)} pointerEvents="none" />
          )}
        </PanZoom>
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
          Blue: reference outline · orange: level outline · circles: reference stairs/elevators · squares: this level&apos;s (they should overlap)
        </div>
      </div>
      <aside className="w-80 shrink-0 space-y-4 overflow-y-auto border-l border-neutral-200 bg-white p-3 text-sm">
        <div className="flex items-center gap-2">
          <Link href={`/b/${building}`} className="text-blue-700 hover:underline">
            {building}
          </Link>
          <span className="font-semibold">/ align to {alignment.referenceLevel}</span>
        </div>
        <label className="flex items-center gap-2">
          Level
          <select className="rounded border px-1" value={level ?? ""} onChange={(e) => { setLevel(e.target.value); setPendingSrc(null); setAlternatives([]); }}>
            {levelIds.map((id) => (
              <option key={id} value={id}>
                {id} {alignment.levels[id]?.transform ? "✓" : ""}
              </option>
            ))}
          </select>
        </label>
        {level && moving && (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                className="flex items-center gap-1 rounded border px-2 py-1 hover:bg-neutral-50"
                onClick={() => {
                  if (!moving.outline || !ref.outline) return setMessage("Both levels need an outline.");
                  const res = autoAlign(moving.outline, ref.outline);
                  update(level, { transform: res.transform, rms: res.error, anchors: [], rotationHint: res.rotationDeg as 0 | 90 | 180 | 270 });
                  setAlternatives(res.candidates.slice(1).filter((c) => c.error < 2 * res.error));
                  setMessage(`Auto-aligned (rotated ${res.rotationDeg}°, outline error ${res.error.toFixed(1)} px). Partial floors usually need anchors instead.`);
                }}
              >
                <MagicWand /> Auto-align
              </button>
              {[-90, 90].map((deg) => (
                <button
                  key={deg}
                  className="flex items-center gap-1 rounded border px-2 py-1 hover:bg-neutral-50"
                  title="Rotate the overlay by a quarter turn"
                  onClick={() => {
                    const c = centroid(ref.outline ?? [[0, 0], [W, H], [0, H]]);
                    const base = transform ?? { scale: 1, rotation: 0, tx: 0, ty: 0 };
                    update(level, { transform: rotateAbout(base, deg, c), anchors: [], rms: null });
                  }}
                >
                  {deg < 0 ? <ArrowCounterClockwise /> : <ArrowClockwise />} {Math.abs(deg)}°
                </button>
              ))}
            </div>
            {alternatives.length > 0 && (
              <div className="rounded bg-amber-50 p-2 text-xs text-amber-900">
                Close alternatives. Check that the stair squares sit on the stair circles:
                <div className="mt-1 flex flex-wrap gap-2">
                  {alternatives.map((c) => (
                    <button key={c.rotationDeg} className="rounded border border-amber-300 bg-white px-2 py-0.5" onClick={() => update(level, { transform: c.transform, rms: c.error, anchors: [], rotationHint: c.rotationDeg as 0 | 90 | 180 | 270 })}>
                      rotate {c.rotationDeg}° ({c.error.toFixed(1)} px)
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2">
              Overlay opacity
              <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </label>
            <div>
              <h3 className="font-semibold">Anchors</h3>
              <p className="text-xs text-neutral-500">Click a feature on the overlay (e.g. a stairwell corner), then the same feature on the reference. Two or more anchors replace the auto result.</p>
              <ul className="mt-1 space-y-1 text-xs">
                {(state?.anchors ?? []).map((a, i) => {
                  const res = transform ? residuals([a], transform)[0]! : 0;
                  return (
                    <li key={i} className="flex items-center gap-2">
                      #{i + 1} residual {res.toFixed(1)} px
                      <button className="ml-auto text-red-700" onClick={() => setAnchors((state?.anchors ?? []).filter((_, j) => j !== i))}>
                        <Trash />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="text-xs">
              {transform ? (
                <>
                  Scale {transform.scale.toFixed(3)} · rotation {((transform.rotation * 180) / Math.PI).toFixed(1)}° · {state?.anchors.length ? `anchor rms ${state?.rms?.toFixed(1)} px` : `outline error ${state?.rms?.toFixed(1)} px`}
                </>
              ) : (
                "Not aligned yet."
              )}
            </p>
            <button className="text-xs text-red-700 hover:underline" onClick={() => update(level, { transform: null, rms: null, anchors: [] })}>
              Clear alignment for {level}
            </button>
          </>
        )}
        {message && <p className="rounded bg-neutral-100 p-2 text-xs">{message}</p>}
        <Link href={`/b/${building}/osm`} className="block text-blue-700 hover:underline">
          Next: fit {alignment.referenceLevel} to OpenStreetMap →
        </Link>
      </aside>
    </div>
  );
}

function pts(poly: Point[]): string {
  return poly.map(([x, y]) => `${x},${y}`).join(" ");
}
