"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Building, Level, Point } from "@wf/schema";
import { api } from "@/lib/client";
import { proposeShafts, shaftToGraph, type ShaftProposal } from "@/lib/shafts";
import { PanZoom, type PanZoomHandle } from "@/components/PanZoom";

const LEVEL_COLORS = ["#0ea5e9", "#a855f7", "#16a34a", "#f59e0b", "#ef4444", "#14b8a6", "#6366f1", "#84cc16"];

export function Shafts({ building }: { building: string }) {
  const [data, setData] = useState<{ building: Building | null; levels: Level[] } | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [maxDistance, setMaxDistance] = useState(4);
  const [proposals, setProposals] = useState<(ShaftProposal & { keep: boolean })[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [upp, setUpp] = useState(0.1);
  const canvas = useRef<PanZoomHandle>(null);
  const fitted = useRef(false);

  useEffect(() => {
    api.canonical(building).then(
      (d) => {
        setData(d);
        setLevels([...d.levels].sort((a, b) => a.sortIndex - b.sortIndex));
      },
      (e: Error) => setMessage(e.message),
    );
  }, [building]);

  const nodes = useMemo(() => new Map(levels.flatMap((l) => l.nodes.map((n) => [n.id, { ...n, levelIndex: levels.indexOf(l) }] as const))), [levels]);

  useEffect(() => {
    if (fitted.current || !data?.building?.footprint.length || !canvas.current) return;
    fitted.current = true;
    const xs = data.building.footprint.map((p) => p[0]);
    const ys = data.building.footprint.map((p) => -p[1]);
    canvas.current.fit({ x: Math.min(...xs) - 10, y: Math.min(...ys) - 10, w: Math.max(...xs) - Math.min(...xs) + 20, h: Math.max(...ys) - Math.min(...ys) + 20 });
  });

  if (message && !data) return <p className="p-6 text-red-700">{message}</p>;
  if (!data) return <p className="p-6 text-neutral-500">Loading…</p>;
  if (!data.building || levels.length === 0)
    return (
      <p className="p-6">
        No accepted levels yet.{" "}
        <Link className="text-blue-700 underline" href={`/b/${building}`}>
          Accept levels first
        </Link>
        .
      </p>
    );

  const b = data.building;
  const existing = b.shafts;
  const r = (px: number) => px * upp;
  const d = (p: Point) => `${p[0]},${-p[1]}`;

  async function save(nextShafts: Building["shafts"], verticalEdges: Building["edges"]) {
    const nextBuilding: Building = { ...b, shafts: nextShafts, edges: [...b.edges.filter((e) => e.kind === "outdoor"), ...verticalEdges] };
    await api.saveCanonical(building, nextBuilding, levels);
    setData({ building: nextBuilding, levels });
    setMessage(`Saved ${nextShafts.length} shafts and ${levels.length} level heights.`);
  }

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1 bg-neutral-100">
        <PanZoom ref={canvas} width={100} height={100} className="h-full w-full" onViewChange={setUpp} leftDragPans>
          <rect x={-2000} y={-2000} width={4000} height={4000} fill="#fafaf9" data-bg="1" />
          <polygon points={b.footprint.map(d).join(" ")} fill="none" stroke="#a8a29e" strokeWidth={r(2)} pointerEvents="none" />
          {levels.map((l, i) => (
            <polygon key={l.id} points={l.outline.map(d).join(" ")} fill="none" stroke={LEVEL_COLORS[i % LEVEL_COLORS.length]} strokeOpacity={0.5} strokeWidth={r(1.5)} pointerEvents="none" />
          ))}
          {[...existing.map((s) => ({ ids: s.nodeIds, keep: true, saved: true })), ...proposals.map((p) => ({ ids: p.nodeIds, keep: p.keep, saved: false }))].map((s, i) => (
            <polyline
              key={i}
              points={s.ids.map((id) => nodes.get(id)).filter(Boolean).map((n) => `${n!.x},${-n!.y}`).join(" ")}
              fill="none"
              stroke={s.saved ? "#111" : s.keep ? "#db2777" : "#d6d3d1"}
              strokeWidth={r(3)}
              pointerEvents="none"
            />
          ))}
          {[...nodes.values()]
            .filter((n) => n.kind === "stair" || n.kind === "elevator")
            .map((n) => (
              <g key={n.id} pointerEvents="none">
                {n.kind === "stair" ? (
                  <circle cx={n.x} cy={-n.y} r={r(5)} fill={LEVEL_COLORS[n.levelIndex % LEVEL_COLORS.length]} />
                ) : (
                  <rect x={n.x - r(5)} y={-n.y - r(5)} width={r(10)} height={r(10)} fill={LEVEL_COLORS[n.levelIndex % LEVEL_COLORS.length]} />
                )}
              </g>
            ))}
        </PanZoom>
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
          Plan view, north up. Circles: stairs · squares: elevators · colored by level · pink: proposed shafts · black: saved
        </div>
      </div>
      <aside className="w-96 shrink-0 space-y-4 overflow-y-auto border-l border-neutral-200 bg-white p-3 text-sm">
        <div className="flex items-center gap-2">
          <Link href={`/b/${building}`} className="text-blue-700 hover:underline">
            {building}
          </Link>
          <span className="font-semibold">/ shafts & heights</span>
        </div>

        <section>
          <h3 className="mb-1 font-semibold">Level heights</h3>
          <table className="w-full text-xs">
            <thead className="text-left text-neutral-500">
              <tr>
                <th />
                <th>Level</th>
                <th>Elevation m</th>
                <th>Height m</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {[...levels].reverse().map((l) => (
                <tr key={l.id}>
                  <td>
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: LEVEL_COLORS[levels.indexOf(l) % LEVEL_COLORS.length] }} />
                  </td>
                  <td>
                    {l.displayName}
                    {!l.verified && <span className="text-amber-700"> ?</span>}
                  </td>
                  {(["elevationM", "heightM"] as const).map((k) => (
                    <td key={k}>
                      <input
                        type="number"
                        step={0.05}
                        className="w-16 rounded border px-1"
                        value={l[k]}
                        onChange={(e) => setLevels(levels.map((x) => (x.id === l.id ? { ...x, [k]: Number(e.target.value), heightSource: "measured" } : x)))}
                      />
                    </td>
                  ))}
                  <td>{l.heightSource}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-neutral-500">Defaults come from config.yaml. Stair step counts from the field walk (M5) will refine these.</p>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold">Shafts ({existing.length} saved)</h3>
          <label className="flex items-center gap-2 text-xs">
            Max horizontal offset between floors
            <input type="number" className="w-14 rounded border px-1" value={maxDistance} step={0.5} onChange={(e) => setMaxDistance(Number(e.target.value))} /> m
          </label>
          <button className="rounded border px-2 py-1 hover:bg-neutral-50" onClick={() => setProposals(proposeShafts(levels, maxDistance).map((p) => ({ ...p, keep: true })))}>
            Propose shafts
          </button>
          {proposals.length > 0 && (
            <ul className="space-y-1 text-xs">
              {proposals.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input type="checkbox" checked={p.keep} onChange={(e) => setProposals(proposals.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                  {p.kind} · {p.levelIds.join(" → ")} · max offset {p.maxOffsetM} m
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              className="rounded bg-blue-700 px-3 py-1.5 text-white disabled:opacity-50"
              onClick={() => {
                const kept = proposals.filter((p) => p.keep);
                const graphs = kept.map((p, i) => shaftToGraph(b.id, i + 1, p));
                void save(graphs.map((g) => g.shaft), graphs.flatMap((g) => g.edges));
                setProposals([]);
              }}
              disabled={proposals.length === 0}
            >
              Save shafts & heights
            </button>
            <button className="rounded border px-3 py-1.5" onClick={() => void save(existing, b.edges.filter((e) => e.kind !== "outdoor"))}>
              Save heights only
            </button>
          </div>
          {existing.length > 0 && (
            <ul className="text-xs text-neutral-600">
              {existing.map((s) => (
                <li key={s.id}>
                  {s.id}: {s.nodeIds.map((id) => nodes.get(id)?.levelId ?? "?").join(" → ")}
                </li>
              ))}
            </ul>
          )}
        </section>
        {message && <p className="rounded bg-neutral-100 p-2 text-xs">{message}</p>}
      </aside>
    </div>
  );
}
