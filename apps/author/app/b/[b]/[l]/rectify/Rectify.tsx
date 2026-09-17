"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, fileUrl } from "@/lib/client";
import { PanZoom, type PanZoomHandle } from "@/components/PanZoom";

type Corners = [number, number][];
const LABELS = ["TL", "TR", "BR", "BL"];

export function Rectify({ building, level }: { building: string; level: string }) {
  const [corners, setCorners] = useState<Corners | null>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(Date.now());
  const [upp, setUpp] = useState(3);
  const canvas = useRef<PanZoomHandle>(null);

  useEffect(() => {
    api.corners(building, level).then(
      (c) => {
        setSize(c.size);
        setCorners(c.corners);
      },
      (e: Error) => setStatus(e.message),
    );
  }, [building, level]);

  useEffect(() => {
    const up = () => setDragging(null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  if (!size || !corners) return <p className="p-6 text-neutral-500">{status ?? "Loading… (run the pipeline's ingest and rectify stages first)"}</p>;
  const [W, H] = size;
  const r = (px: number) => px * upp;

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 bg-neutral-800">
        <PanZoom
          ref={canvas}
          width={W}
          height={H}
          className="h-full w-full"
          leftDragPans={dragging === null}
          onViewChange={setUpp}
          onPointerMove={(_e, at) => {
            if (dragging === null) return;
            setCorners(corners.map((c, i) => (i === dragging ? [Math.round(at[0]), Math.round(at[1])] : c)) as Corners);
          }}
        >
          <image href={fileUrl(building, level, "ingest.jpg", version)} width={W} height={H} data-bg="1" />
          <polygon points={corners.map((c) => c.join(",")).join(" ")} fill="#db2777" fillOpacity={0.08} stroke="#db2777" strokeWidth={r(2)} pointerEvents="none" />
          {corners.map((c, i) => (
            <g key={i}>
              <circle cx={c[0]} cy={c[1]} r={r(10)} fill="#db2777" fillOpacity={0.4} stroke="#fff" strokeWidth={r(2)} style={{ cursor: "grab" }} onPointerDown={(e) => { e.stopPropagation(); setDragging(i); }} />
              <text x={c[0] + r(14)} y={c[1] - r(8)} fontSize={r(16)} fill="#fff" stroke="#000" strokeWidth={r(3)} paintOrder="stroke" pointerEvents="none">
                {LABELS[i]}
              </text>
            </g>
          ))}
        </PanZoom>
      </div>
      <aside className="w-80 shrink-0 space-y-3 overflow-y-auto border-l border-neutral-200 bg-white p-3 text-sm">
        <div className="flex items-center gap-2">
          <Link href={`/b/${building}`} className="text-blue-700 hover:underline">
            {building}
          </Link>
          <span className="font-semibold">/ {level} board corners</span>
        </div>
        <p className="text-xs text-neutral-600">
          Drag the four handles onto the corners of the placard board (or onto any rectangle drawn parallel to its edges, such as the plan&apos;s frame, if a corner is cut off). Saving writes <code>corners.json</code> and re-runs the pipeline for this level.
        </p>
        <p className="text-xs text-neutral-600">
          Needs the pipeline service: <code>cd pipeline &amp;&amp; uv run wf serve</code>. If this level has hand edits, they&apos;re kept, and the new output shows up as &quot;newer pipeline output&quot; in the editor.
        </p>
        <button
          disabled={busy}
          className="rounded bg-blue-700 px-3 py-1.5 text-white disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            setStatus("Saving corners and running the pipeline (can take a minute)…");
            try {
              await api.saveCorners(building, level, corners);
              const res = await api.run(building, level, "rectify");
              setStatus(res.ok ? `Done: ${res.ran.join(" → ")}\n${res.log}` : `Failed at ${res.failedStage}: ${res.error}\n${res.log}`);
              setVersion(Date.now());
            } catch (e) {
              setStatus((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save & re-run pipeline
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileUrl(building, level, "rectified.jpg", version)} alt="current rectified board" className="w-full rounded border" />
        {status && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-100 p-2 text-xs">{status}</pre>}
      </aside>
    </div>
  );
}
