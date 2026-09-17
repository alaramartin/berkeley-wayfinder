"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MagicWand, Trash } from "@phosphor-icons/react";
import { apply, flipSimilarity, invert, toLocal } from "@wf/geometry";
import type { Alignment, AnchorPair, LatLon, Point, Proposal } from "@wf/schema";
import { autoAlign, fromAnchors, residuals, svgMatrix, type AutoAlignResult } from "@/lib/align";
import { api, fileUrl, type OsmFootprint } from "@/lib/client";
import { PanZoom, type PanZoomHandle } from "@/components/PanZoom";

/**
 * Display coordinates are world meters with y negated (SVG y points down): display = (x, -y).
 * The reference image is drawn with flipSimilarity(osm.transform), which maps image px straight to display coords.
 */
export function OsmFitPage({ building }: { building: string }) {
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const [osm, setOsm] = useState<OsmFootprint | null>(null);
  const [ref, setRef] = useState<Proposal | null>(null);
  const [pendingSrc, setPendingSrc] = useState<Point | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<AutoAlignResult["candidates"]>([]);
  const [upp, setUpp] = useState(0.1);
  const canvas = useRef<PanZoomHandle>(null);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      const summary = await api.building(building);
      setAlignment(summary.alignment);
      setOsm(summary.osm ?? (await api.fetchOsm(building)));
      setRef(await api.proposal(building, summary.alignment.referenceLevel));
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

  const origin: LatLon | null = useMemo(() => {
    if (alignment?.osm.origin) return alignment.osm.origin;
    if (!osm) return null;
    const ring = osm.ring.slice(0, -1).length ? osm.ring.slice(0, -1) : osm.ring;
    return { lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length, lon: ring.reduce((s, p) => s + p.lon, 0) / ring.length };
  }, [alignment, osm]);
  const footprint: Point[] = useMemo(() => (osm && origin ? osm.ring.map((p) => toLocal(origin, p)) : []), [osm, origin]);

  // Fit the view to the footprint once the canvas exists (it mounts only after everything has loaded).
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !footprint.length || !canvas.current) return;
    fitted.current = true;
    const xs = footprint.map((p) => p[0]);
    const ys = footprint.map((p) => -p[1]);
    canvas.current.fit({ x: Math.min(...xs) - 20, y: Math.min(...ys) - 20, w: Math.max(...xs) - Math.min(...xs) + 40, h: Math.max(...ys) - Math.min(...ys) + 40 });
  });

  if (message && !alignment) return <p className="p-6 text-red-700">{message}</p>;
  if (!alignment || !osm || !ref || !origin) return <p className="p-6 text-neutral-500">{message ?? "Loading…"}</p>;

  const t = alignment.osm.transform;
  const display = t ? flipSimilarity(t) : null; // image px -> display coords
  const r = (px: number) => px * upp;
  const toDisplay = (p: Point): Point => [p[0], -p[1]];

  function setOsmFit(patch: Partial<Alignment["osm"]>) {
    setAlignment((a) => (a ? { ...a, osm: { ...a.osm, wayId: osm!.wayId, origin, ...patch } } : a));
  }

  function setAnchors(anchors: AnchorPair[]) {
    // Anchors: src = reference px, dst = world meters. The fit runs on (x, -y) of the pixels.
    const fit = fromAnchors(anchors.map((a) => ({ src: [a.src[0], -a.src[1]], dst: a.dst })));
    setOsmFit(fit ? { anchors, transform: fit.transform, rms: fit.rms } : { anchors });
  }

  function onClick(at: Point) {
    if (!display) return setMessage("Run Auto-fit first, then refine with anchors.");
    if (!pendingSrc) {
      setPendingSrc(apply(invert(display), at));
      setMessage("Now click the matching footprint corner (snaps to the nearest vertex).");
      return;
    }
    const world: Point = [at[0], -at[1]];
    let best = world;
    let bestD = 25 * upp;
    for (const v of footprint) {
      const d = Math.hypot(v[0] - world[0], v[1] - world[1]);
      if (d < bestD) [bestD, best] = [d, v];
    }
    setAnchors([...alignment!.osm.anchors, { src: pendingSrc, dst: best }]);
    setPendingSrc(null);
    setMessage(null);
  }

  const [W, H] = ref.imageSize;
  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1 bg-neutral-100">
        <PanZoom ref={canvas} width={100} height={100} className="h-full w-full" cursor="crosshair" onViewChange={setUpp} onBackgroundPointerDown={(_e, at) => onClick(at)}>
          <rect x={-2000} y={-2000} width={4000} height={4000} fill="#f5f5f4" data-bg="1" />
          {display && (
            <g transform={svgMatrix(display)} pointerEvents="none">
              <image href={fileUrl(building, alignment.referenceLevel, "rectified.jpg")} width={W} height={H} opacity={0.55} />
              {ref.outline && <polygon points={pts(ref.outline)} fill="none" stroke="#ea580c" strokeWidth={r(2) / display.scale} />}
            </g>
          )}
          <polygon points={pts(footprint.map(toDisplay))} fill="#2563eb" fillOpacity={0.08} stroke="#2563eb" strokeWidth={r(2.5)} pointerEvents="none" />
          {footprint.map((v, i) => (
            <circle key={i} cx={v[0]} cy={-v[1]} r={r(4)} fill="#2563eb" pointerEvents="none" />
          ))}
          {display &&
            alignment.osm.anchors.map((a, i) => {
              const s = apply(display, a.src);
              return (
                <g key={i} pointerEvents="none">
                  <line x1={s[0]} y1={s[1]} x2={a.dst[0]} y2={-a.dst[1]} stroke="#db2777" strokeWidth={r(2)} />
                  <circle cx={a.dst[0]} cy={-a.dst[1]} r={r(5)} fill="#db2777" />
                </g>
              );
            })}
          <g pointerEvents="none">
            <line x1={0} y1={0} x2={0} y2={-10} stroke="#111" strokeWidth={r(2)} />
            <text x={r(4)} y={-10} fontSize={r(12)}>
              N
            </text>
          </g>
        </PanZoom>
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">Blue: OpenStreetMap footprint (north up) · orange: {alignment.referenceLevel} outline</div>
      </div>
      <aside className="w-80 shrink-0 space-y-3 overflow-y-auto border-l border-neutral-200 bg-white p-3 text-sm">
        <div className="flex items-center gap-2">
          <Link href={`/b/${building}`} className="text-blue-700 hover:underline">
            {building}
          </Link>
          <span className="font-semibold">/ fit {alignment.referenceLevel} to OSM</span>
        </div>
        <p className="text-xs text-neutral-500">
          OSM way {osm.wayId} ({osm.name}), fetched {new Date(osm.fetchedAt).toLocaleDateString()}.
        </p>
        <button
          className="flex items-center gap-1 rounded border px-2 py-1 hover:bg-neutral-50"
          onClick={() => {
            if (!ref.outline) return setMessage("Reference level has no outline.");
            const res = autoAlign(ref.outline.map(([x, y]) => [x, -y] as Point), footprint);
            setOsmFit({ transform: res.transform, rms: res.error, anchors: [] });
            setAlternatives(res.candidates.slice(1).filter((c) => c.error < 3 * res.error));
            setMessage(`Auto-fit: rotated ${res.rotationDeg}°, ${res.transform.scale.toFixed(4)} m/px, mean outline error ${res.error.toFixed(2)} m.`);
          }}
        >
          <MagicWand /> Auto-fit
        </button>
        {alternatives.length > 0 && (
          <div className="rounded bg-amber-50 p-2 text-xs text-amber-900">
            The footprint is nearly symmetric. Check the orientation against a feature you know (e.g. which side the main entrance is on). Other fits:
            <div className="mt-1 flex flex-wrap gap-2">
              {alternatives.map((c) => (
                <button key={c.rotationDeg} className="rounded border border-amber-300 bg-white px-2 py-0.5" onClick={() => setOsmFit({ transform: c.transform, rms: c.error, anchors: [] })}>
                  rotate {c.rotationDeg}° ({c.error.toFixed(2)} m)
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <h3 className="font-semibold">Anchors</h3>
          <p className="text-xs text-neutral-500">Click a building corner on the overlay, then the same corner on the blue footprint.</p>
          <ul className="mt-1 space-y-1 text-xs">
            {alignment.osm.anchors.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                #{i + 1} residual {t ? residuals([{ src: [a.src[0], -a.src[1]], dst: a.dst }], t)[0]!.toFixed(2) : "–"} m
                <button className="ml-auto text-red-700" onClick={() => setAnchors(alignment.osm.anchors.filter((_, j) => j !== i))}>
                  <Trash />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs">{t ? `${t.scale.toFixed(4)} m/px · error ${alignment.osm.rms?.toFixed(2)} m · origin ${origin.lat.toFixed(6)}, ${origin.lon.toFixed(6)}` : "Not fitted yet."}</p>
        {message && <p className="rounded bg-neutral-100 p-2 text-xs">{message}</p>}
        <Link href={`/b/${building}`} className="block text-blue-700 hover:underline">
          Next: accept levels on the overview →
        </Link>
      </aside>
    </div>
  );
}

function pts(poly: Point[]): string {
  return poly.map(([x, y]) => `${x},${y}`).join(" ");
}
