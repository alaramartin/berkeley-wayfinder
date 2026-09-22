"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowArcLeft,
  ArrowArcRight,
  CheckCircle,
  CursorClick,
  Door,
  GitBranch,
  LineSegment,
  Polygon as PolygonIcon,
  Scissors,
  Warning,
} from "@phosphor-icons/react";
import type { Point, Proposal, ProposalRoom, RoomCategory } from "@wf/schema";
import { acceptBlockers } from "@/lib/accept";
import { api, fileUrl } from "@/lib/client";
import { CATEGORY_COLORS, NODE_COLORS } from "@/lib/colors";
import {
  addEdge,
  addNode,
  components as graphComponents,
  deleteEdge,
  deleteNode,
  doorPoint,
  moveNode,
  projectToGraph,
  setDoor,
  setNodeKind,
  splitEdge,
} from "@/lib/graph";
import { nextId, roomIdForNumber } from "@/lib/ids";
import { centroid, splitPolygon } from "@/lib/polygon";
import { assignSplit } from "@/lib/split";
import { useHistory } from "@/lib/useHistory";
import { PanZoom, type PanZoomHandle } from "@/components/PanZoom";

type Tool = "select" | "node" | "edge" | "door" | "split" | "room";
type Selection = { type: "node" | "edge" | "room"; id: string } | null;
type Target = { type: "node" | "edge" | "room"; id: string } | null;

const TOOLS: { id: Tool; key: string; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "select", key: "v", label: "Select", icon: <CursorClick />, hint: "Click to select, drag nodes. Drag empty space to pan." },
  { id: "node", key: "n", label: "Node", icon: <GitBranch />, hint: "Click a corridor to split it, or empty space to add a node." },
  { id: "edge", key: "e", label: "Corridor", icon: <LineSegment />, hint: "Click nodes (or empty space) in sequence to draw corridors. Esc to finish." },
  { id: "door", key: "d", label: "Door", icon: <Door />, hint: "With a room selected, click the corridor where its door is. \u21e7D adds another door." },
  { id: "split", key: "s", label: "Split room", icon: <Scissors />, hint: "With a room selected, click two points on the dividing line." },
  { id: "room", key: "r", label: "Draw room", icon: <PolygonIcon />, hint: "Click corners; click the first corner or press Enter to close." },
];
const CATEGORIES: RoomCategory[] = ["classroom", "computer-lab", "seminar", "library", "office", "restroom", "lactation", "auditorium", "service", "other"];
const NEEDS_IDENTITY = new Set(["classroom", "computer-lab", "seminar", "library", "office", "lactation", "auditorium", "other", "restroom"]);

export function Editor({ building, level }: { building: string; level: string }) {
  const history = useHistory<Proposal | null>(null);
  const p = history.present;
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [pending, setPending] = useState<{ edgeFrom?: string; splitFrom?: Point; roomPoints?: Point[]; doorIndex?: number }>({});
  const [cursor, setCursor] = useState<Point | null>(null);
  const [layers, setLayers] = useState({ photo: true, rooms: true, labels: true, corridors: true, doors: true, icons: false });
  const [upp, setUpp] = useState(2);
  const [highlight, setHighlight] = useState<string[] | null>(null);
  const [openReview, setOpenReview] = useState(0);
  const [hasAuto, setHasAuto] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const canvas = useRef<PanZoomHandle>(null);
  const loaded = useRef(false);
  const drag = useRef<{ id: string; base: Proposal } | null>(null);

  const load = useCallback(async () => {
    try {
      const [proposal, queue, summary] = await Promise.all([api.proposal(building, level), api.queue(building, level), api.building(building)]);
      loaded.current = false;
      history.reset(proposal);
      setOpenReview(queue.items.filter((i) => !i.resolved).length);
      setHasAuto(Boolean(summary.levels.find((l) => l.id === level)?.hasNewerAuto));
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building, level]);
  useEffect(() => {
    void load();
  }, [load]);

  // Autosave (debounced) after any change that isn't the initial load.
  useEffect(() => {
    if (!p) return;
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    if (drag.current) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      api.saveProposal(building, level, p).then(
        () => setSaveState("saved"),
        (e: Error) => {
          setSaveState("error");
          setError(e.message);
        },
      );
    }, 700);
    return () => clearTimeout(t);
  }, [p, building, level]);

  const comps = useMemo(() => (p ? graphComponents(p) : []), [p]);
  const blockers = useMemo(() => (p ? acceptBlockers(p, Array.from({ length: openReview }, (_, i) => ({ id: `x${i}`, kind: "icon" as const, crop: "", candidates: [], targetId: "x" }))) : []), [p, openReview]);
  const nodeById = useMemo(() => new Map((p?.nodes ?? []).map((n) => [n.id, n])), [p]);
  const selectedRoom = selection?.type === "room" ? p?.rooms.find((r) => r.id === selection.id) : undefined;
  const selectedNode = selection?.type === "node" ? nodeById.get(selection.id) : undefined;
  const selectedEdge = selection?.type === "edge" ? p?.edges.find((e) => e.id === selection.id) : undefined;

  const commit = useCallback((next: Proposal) => history.commit(next), [history]);

  const nearestNode = useCallback(
    (at: Point, radiusPx = 12): string | null => {
      if (!p) return null;
      let best: string | null = null;
      let bestD = radiusPx * upp;
      for (const n of p.nodes) {
        const d = Math.hypot(n.x - at[0], n.y - at[1]);
        if (d < bestD) [bestD, best] = [d, n.id];
      }
      return best;
    },
    [p, upp],
  );

  /** Resolve a click to a node id, creating/splitting as needed (node & corridor tools). */
  const nodeAt = useCallback(
    (proposal: Proposal, at: Point, target: Target): { proposal: Proposal; nodeId: string } => {
      const existing = target?.type === "node" ? target.id : nearestNode(at);
      if (existing) return { proposal, nodeId: existing };
      const edgeTarget = target?.type === "edge" ? target.id : (() => {
        const proj = projectToGraph(proposal, at);
        return proj && proj.distance < 10 * upp ? proj.edgeId : null;
      })();
      if (edgeTarget) return splitEdge(proposal, edgeTarget, at);
      return addNode(proposal, at);
    },
    [nearestNode, upp],
  );

  const onCanvasDown = useCallback(
    (at: Point, target: Target) => {
      if (!p) return;
      switch (tool) {
        case "select": {
          setSelection(target);
          if (target?.type === "node") drag.current = { id: target.id, base: p };
          return;
        }
        case "node": {
          const r = nodeAt(p, at, target?.type === "room" ? null : target);
          if (r.proposal !== p) commit(r.proposal);
          setSelection({ type: "node", id: r.nodeId });
          return;
        }
        case "edge": {
          const r = nodeAt(p, at, target?.type === "room" ? null : target);
          let next = r.proposal;
          if (pending.edgeFrom && pending.edgeFrom !== r.nodeId) next = addEdge(next, pending.edgeFrom, r.nodeId);
          if (next !== p) commit(next);
          setPending({ edgeFrom: r.nodeId });
          return;
        }
        case "door": {
          if (!selectedRoom) return setError("Select a room first, then place its door.");
          commit(setDoor(p, selectedRoom.id, at, pending.doorIndex ?? 0));
          setTool("select");
          setPending({});
          return;
        }
        case "split": {
          if (!selectedRoom) return setError("Select a room first, then click two points across it.");
          if (!pending.splitFrom) return setPending({ splitFrom: at });
          const parts = splitPolygon(selectedRoom.polygon, pending.splitFrom, at);
          setPending({});
          if (!parts) return setError("That line doesn't cut the room into two pieces.");
          commit({ ...p, rooms: assignSplit(p, selectedRoom, parts) });
          setTool("select");
          return;
        }
        case "room": {
          const pts = pending.roomPoints ?? [];
          if (pts.length >= 3 && Math.hypot(pts[0]![0] - at[0], pts[0]![1] - at[1]) < 12 * upp) return finishRoom(pts);
          setPending({ roomPoints: [...pts, at] });
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p, tool, pending, selectedRoom, nodeAt, commit, upp],
  );

  function finishRoom(pts: Point[]) {
    if (!p || pts.length < 3) return;
    const id = nextId(p, "g");
    commit({ ...p, rooms: [...p.rooms, { id, regionId: id, number: null, numberConfidence: 0, category: "office", group: null, polygon: round(pts), doors: [], aliases: [] }] });
    setPending({});
    setSelection({ type: "room", id });
    setTool("select");
  }

  // Node dragging.
  useEffect(() => {
    const up = () => {
      if (drag.current && history.present && history.present !== drag.current.base) {
        const final = history.present;
        history.reset(drag.current.base);
        history.commit(final);
      }
      drag.current = null;
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [history]);

  const updateRoom = useCallback(
    (id: string, patch: Partial<ProposalRoom>) => {
      if (!p) return;
      commit({ ...p, rooms: p.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
    },
    [p, commit],
  );

  const deleteSelection = useCallback(() => {
    if (!p || !selection) return;
    if (selection.type === "node") commit(deleteNode(p, selection.id));
    if (selection.type === "edge") commit(deleteEdge(p, selection.id));
    if (selection.type === "room") commit({ ...p, rooms: p.rooms.filter((r) => r.id !== selection.id) });
    setSelection(null);
  }, [p, selection, commit]);

  const toggleEntrance = useCallback(
    (nodeId: string) => {
      if (!p) return;
      const entrances = p.entrances ?? [];
      const existing = entrances.find((e) => e.nodeId === nodeId);
      if (existing) {
        commit(setNodeKind({ ...p, entrances: entrances.filter((e) => e !== existing) }, nodeId, "junction"));
      } else {
        const id = nextId(p, "x");
        commit(setNodeKind({ ...p, entrances: [...entrances, { id, nodeId, accessible: false, evidence: [], confidence: 1 }] }, nodeId, "entrance"));
      }
    },
    [p, commit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) {
        setTool(t.id);
        // Shift+D adds another door to the selected room instead of moving its first one.
        setPending(t.id === "door" && e.shiftKey && selectedRoom ? { doorIndex: selectedRoom.doors.length } : {});
        return;
      }
      if (e.key === "Escape") {
        setPending({});
        if (tool !== "select") setTool("select");
        else setSelection(null);
      }
      if (e.key === "Enter" && tool === "room" && pending.roomPoints) finishRoom(pending.roomPoints);
      if (e.key === "Delete" || e.key === "Backspace") deleteSelection();
      if (e.key === "f") canvas.current?.fit();
      if (e.key === "x" && selectedNode) toggleEntrance(selectedNode.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, tool, pending, deleteSelection, selectedNode, selectedRoom, toggleEntrance]);

  // Start zoomed to the building rather than the whole placard.
  const fitted = useRef(false);
  useEffect(() => {
    if (!p || fitted.current || !canvas.current) return;
    fitted.current = true;
    const outline = p.outline ?? p.rooms.flatMap((r) => r.polygon);
    if (!outline.length) return;
    const xs = outline.map((q) => q[0]);
    const ys = outline.map((q) => q[1]);
    canvas.current.fit({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  });

  if (error && !p) return <p className="p-6 text-red-700">{error}</p>;
  if (!p) return <p className="p-6 text-neutral-500">Loading…</p>;

  const [W, H] = p.imageSize;
  const r = (px: number) => px * upp;
  const hl = new Set(highlight ?? []);
  const down = (target: Target) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onCanvasDown(canvas.current!.toContent(e.clientX, e.clientY), target);
  };

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1 bg-neutral-800">
        <PanZoom
          ref={canvas}
          width={W}
          height={H}
          className="h-full w-full"
          leftDragPans={tool === "select"}
          cursor={tool === "select" ? "default" : "crosshair"}
          onViewChange={setUpp}
          onBackgroundPointerDown={(_e, at) => onCanvasDown(at, null)}
          onPointerMove={(_e, at) => {
            setCursor(at);
            if (drag.current) history.preview(moveNode(drag.current.base, drag.current.id, at));
          }}
        >
          <rect x={0} y={0} width={W} height={H} fill="#fff" data-bg="1" />
          {layers.photo && <image href={fileUrl(building, level, "rectified.jpg")} x={0} y={0} width={W} height={H} opacity={0.55} data-bg="1" style={{ pointerEvents: "none" }} />}
          {p.outline && <polygon points={pts(p.outline)} fill="none" stroke="#dc2626" strokeWidth={r(2)} strokeDasharray={`${r(8)} ${r(6)}`} pointerEvents="none" />}
          {(p.voids ?? []).map((v, i) => (
            <polygon key={i} points={pts(v)} fill="#0891b2" fillOpacity={0.08} stroke="#0891b2" strokeWidth={r(1.5)} pointerEvents="none" />
          ))}
          {layers.rooms &&
            p.rooms.map((room) => {
              const sel = selection?.type === "room" && selection.id === room.id;
              const missing = NEEDS_IDENTITY.has(room.category) && !room.number && !room.name;
              return (
                <polygon
                  key={room.id}
                  points={pts(room.polygon)}
                  fill={CATEGORY_COLORS[room.category] ?? "#999"}
                  fillOpacity={sel ? 0.45 : 0.22}
                  stroke={sel ? "#111" : missing ? "#db2777" : CATEGORY_COLORS[room.category] ?? "#999"}
                  strokeWidth={r(sel ? 3 : missing ? 2.5 : 1.5)}
                  strokeDasharray={missing ? `${r(6)} ${r(4)}` : undefined}
                  onPointerDown={tool === "select" ? down({ type: "room", id: room.id }) : undefined}
                  style={{ pointerEvents: tool === "select" ? "auto" : "none" }}
                />
              );
            })}
          {layers.corridors &&
            p.edges.map((e) => {
              const sel = selection?.type === "edge" && selection.id === e.id;
              const inHl = hl.has(e.a);
              return (
                <g key={e.id}>
                  <polyline points={pts(e.polyline)} fill="none" stroke="transparent" strokeWidth={r(14)} onPointerDown={down({ type: "edge", id: e.id })} />
                  <polyline points={pts(e.polyline)} fill="none" stroke={sel ? "#111" : inHl ? "#f97316" : "#dc2626"} strokeWidth={r(sel ? 5 : 3.5)} pointerEvents="none" />
                </g>
              );
            })}
          {layers.doors &&
            p.rooms.flatMap((room) =>
              room.doors.map((d, i) => {
                const at = doorPoint(p, d);
                if (!at) return null;
                const c = centroid(room.polygon);
                const sel = selection?.type === "room" && selection.id === room.id;
                return (
                  <g key={`${room.id}-${i}`} pointerEvents="none">
                    {sel && <line x1={c[0]} y1={c[1]} x2={at[0]} y2={at[1]} stroke="#111" strokeWidth={r(1.5)} strokeDasharray={`${r(4)} ${r(3)}`} />}
                    <rect x={at[0] - r(4)} y={at[1] - r(4)} width={r(8)} height={r(8)} fill={d.confidence >= 0.5 ? "#facc15" : "#fb923c"} stroke="#111" strokeWidth={r(1)} />
                  </g>
                );
              }),
            )}
          {layers.corridors &&
            p.nodes.map((n) => {
              const sel = selection?.type === "node" && selection.id === n.id;
              return (
                <circle
                  key={n.id}
                  cx={n.x}
                  cy={n.y}
                  r={r(n.kind === "junction" ? 5 : 7)}
                  fill={hl.has(n.id) ? "#f97316" : NODE_COLORS[n.kind] ?? "#333"}
                  stroke={sel || pending.edgeFrom === n.id ? "#111" : "#fff"}
                  strokeWidth={r(sel ? 3 : 1.5)}
                  onPointerDown={down({ type: "node", id: n.id })}
                  style={{ cursor: tool === "select" ? "move" : "crosshair" }}
                />
              );
            })}
          {layers.icons &&
            p.icons.map((i) => (
              <g key={i.id} pointerEvents="none">
                <rect x={i.at[0] - r(6)} y={i.at[1] - r(6)} width={r(12)} height={r(12)} fill="none" stroke="#7c3aed" strokeWidth={r(2)} />
                <text x={i.at[0] + r(8)} y={i.at[1]} fontSize={r(11)} fill="#7c3aed">
                  {i.kind}
                </text>
              </g>
            ))}
          {layers.labels &&
            p.rooms.map((room) => {
              const c = room.labelAt ?? centroid(room.polygon);
              const label = room.number ?? room.name ?? "?";
              const suiteIndex = room.labelAt ? 0 : room.regionId ? p.rooms.filter((x) => x.regionId === room.regionId && !x.labelAt).indexOf(room) : 0;
              return (
                <text key={room.id} x={c[0]} y={c[1] + suiteIndex * r(15)} fontSize={r(13)} textAnchor="middle" fontWeight={600} fill="#111" stroke="#fff" strokeWidth={r(3)} paintOrder="stroke" pointerEvents="none">
                  {label}
                </text>
              );
            })}
          {tool === "edge" && pending.edgeFrom && cursor && nodeById.get(pending.edgeFrom) && (
            <line x1={nodeById.get(pending.edgeFrom)!.x} y1={nodeById.get(pending.edgeFrom)!.y} x2={cursor[0]} y2={cursor[1]} stroke="#111" strokeWidth={r(2)} strokeDasharray={`${r(6)} ${r(4)}`} pointerEvents="none" />
          )}
          {tool === "split" && pending.splitFrom && cursor && (
            <line x1={pending.splitFrom[0]} y1={pending.splitFrom[1]} x2={cursor[0]} y2={cursor[1]} stroke="#111" strokeWidth={r(2)} pointerEvents="none" />
          )}
          {tool === "room" && pending.roomPoints && cursor && (
            <polyline points={pts([...pending.roomPoints, cursor])} fill="none" stroke="#111" strokeWidth={r(2)} pointerEvents="none" />
          )}
        </PanZoom>
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
          {TOOLS.find((t) => t.id === tool)!.hint} · wheel zoom · space-drag pan · F fit · ⌘Z undo
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-white text-sm">
        <div className="space-y-2 border-b border-neutral-200 p-3">
          <div className="flex items-center gap-2">
            <Link href={`/b/${building}`} className="text-blue-700 hover:underline">
              {building}
            </Link>
            <span className="font-semibold">/ {level}</span>
            <span className="ml-auto text-xs text-neutral-500">{saveState === "saving" ? "saving…" : saveState === "saved" ? "saved" : saveState === "error" ? "save failed" : ""}</span>
          </div>
          <div className="flex gap-2">
            <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={!history.canUndo} onClick={history.undo} title="Undo (⌘Z)">
              <ArrowArcLeft />
            </button>
            <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={!history.canRedo} onClick={history.redo} title="Redo (⇧⌘Z)">
              <ArrowArcRight />
            </button>
            <Link href={`/b/${building}/${level}/review`} className="ml-auto rounded border px-2 py-1 hover:bg-neutral-50">
              Review queue ({openReview})
            </Link>
          </div>
          {error && (
            <p className="rounded bg-red-50 p-2 text-xs text-red-800" onClick={() => setError(null)}>
              {error} (click to dismiss)
            </p>
          )}
          {hasAuto && (
            <div className="rounded bg-blue-50 p-2 text-xs text-blue-900">
              The pipeline produced newer output for this level. Your edits are kept in proposal.json.
              <button
                className="ml-1 font-semibold underline"
                onClick={async () => {
                  if (!confirmReset) return setConfirmReset(true);
                  await api.reset(building, level);
                  setConfirmReset(false);
                  await load();
                }}
              >
                {confirmReset ? "Click again to discard edits and reset" : "Reset to pipeline output…"}
              </button>
            </div>
          )}
          {blockers.length ? (
            <ul className="space-y-1 text-xs text-amber-800">
              {blockers.map((b) => (
                <li key={b} className="flex gap-1">
                  <Warning className="mt-0.5 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-1 text-xs text-green-700">
              <CheckCircle /> Ready to accept
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1 border-b border-neutral-200 p-3">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTool(t.id);
                setPending({});
              }}
              className={`flex flex-col items-center rounded border px-1 py-1.5 text-xs ${tool === t.id ? "border-blue-600 bg-blue-50 text-blue-800" : "border-neutral-200 hover:bg-neutral-50"}`}
              title={t.hint}
            >
              <span className="text-base">{t.icon}</span>
              {t.label} <kbd className="text-[10px] text-neutral-400">{t.key.toUpperCase()}</kbd>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-neutral-200 p-3 text-xs">
          {(Object.keys(layers) as (keyof typeof layers)[]).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
              {k}
            </label>
          ))}
        </div>

        <div className="border-b border-neutral-200 p-3">
          {selectedRoom && (
            <RoomInspector
              key={selectedRoom.id}
              room={selectedRoom}
              suite={p.rooms.filter((x) => x !== selectedRoom && x.polygon.length === selectedRoom.polygon.length && x.polygon.every((q, i) => q[0] === selectedRoom.polygon[i]![0] && q[1] === selectedRoom.polygon[i]![1]))}
              onChange={(patch) => updateRoom(selectedRoom.id, patch)}
              onRenumber={(number) => {
                const clean = number.trim().toUpperCase();
                if (clean && p.rooms.some((x) => x !== selectedRoom && x.number === clean)) return setError(`Room ${clean} already exists on this level.`);
                const id = clean ? roomIdForNumber(p, clean) : selectedRoom.id;
                commit({ ...p, rooms: p.rooms.map((x) => (x === selectedRoom ? { ...x, id, number: clean || null, numberConfidence: 1 } : x)) });
                setSelection({ type: "room", id });
              }}
              onSelect={(id) => setSelection({ type: "room", id })}
              onTool={(t) => {
                setTool(t);
                setPending({});
              }}
              onRemoveDoor={(i) => updateRoom(selectedRoom.id, { doors: selectedRoom.doors.filter((_, j) => j !== i) })}
              onAddDoor={() => {
                setTool("door");
                setPending({ doorIndex: selectedRoom.doors.length });
              }}
              onMoveDoor={(i) => {
                setTool("door");
                setPending({ doorIndex: i });
              }}
              rooms={p.rooms}
              onDelete={deleteSelection}
            />
          )}
          {selectedNode && (
            <div className="space-y-2">
              <h3 className="font-semibold">Node</h3>
              <p className="font-mono text-xs text-neutral-500">{selectedNode.id}</p>
              <label className="flex items-center gap-2">
                Kind
                <select className="rounded border px-1" value={selectedNode.kind} onChange={(e) => commit(setNodeKind(p, selectedNode.id, e.target.value as typeof selectedNode.kind))}>
                  {["junction", "stair", "elevator", "entrance", "door"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              {(() => {
                const ent = (p.entrances ?? []).find((e) => e.nodeId === selectedNode.id);
                return (
                  <div className="space-y-1 rounded bg-neutral-50 p-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!ent} onChange={() => toggleEntrance(selectedNode.id)} /> Building entrance <kbd className="text-[10px] text-neutral-400">X</kbd>
                    </label>
                    {ent && (
                      <>
                        <input
                          className="w-full rounded border px-1"
                          placeholder="Name, e.g. North entrance (Memorial Glade)"
                          defaultValue={ent.name ?? ""}
                          onBlur={(e) => commit({ ...p, entrances: (p.entrances ?? []).map((x) => (x === ent ? { ...x, name: e.target.value || undefined } : x)) })}
                        />
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={ent.accessible} onChange={(e) => commit({ ...p, entrances: (p.entrances ?? []).map((x) => (x === ent ? { ...x, accessible: e.target.checked } : x)) })} />
                          Step-free / accessible
                        </label>
                      </>
                    )}
                  </div>
                );
              })()}
              <button className="text-red-700 hover:underline" onClick={deleteSelection}>
                Delete node and its corridors
              </button>
            </div>
          )}
          {selectedEdge && (
            <div className="space-y-2">
              <h3 className="font-semibold">Corridor</h3>
              <p className="font-mono text-xs text-neutral-500">
                {selectedEdge.id}: {selectedEdge.a} → {selectedEdge.b}
              </p>
              <button className="text-red-700 hover:underline" onClick={deleteSelection}>
                Delete corridor
              </button>
            </div>
          )}
          {!selection && <p className="text-xs text-neutral-500">Nothing selected. Magenta dashed rooms need a number or name.</p>}
        </div>

        <div className="p-3">
          <h3 className="mb-1 font-semibold">Corridor pieces ({comps.length})</h3>
          {comps.length > 1 && <p className="mb-2 text-xs text-neutral-500">Join pieces with the Corridor tool (E). Click a piece to highlight it.</p>}
          <ul className="space-y-1 text-xs">
            {comps.map((c, i) => (
              <li key={c[0]}>
                <button
                  className="hover:underline"
                  onClick={() => {
                    setHighlight(c);
                    const ns = c.map((id) => nodeById.get(id)!).filter(Boolean);
                    const xs = ns.map((n) => n.x);
                    const ys = ns.map((n) => n.y);
                    const pad = 150;
                    canvas.current?.fit({ x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad });
                  }}
                >
                  Piece {i + 1}: {c.length} nodes
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function RoomInspector(props: {
  room: ProposalRoom;
  suite: ProposalRoom[];
  onChange: (patch: Partial<ProposalRoom>) => void;
  onRenumber: (number: string) => void;
  onSelect: (id: string) => void;
  onTool: (t: Tool) => void;
  onRemoveDoor: (i: number) => void;
  onAddDoor: () => void;
  onMoveDoor: (i: number) => void;
  rooms: ProposalRoom[];
  onDelete: () => void;
}) {
  const { room } = props;
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Room</h3>
      <p className="font-mono text-xs text-neutral-500">{room.id}</p>
      <label className="flex items-center gap-2">
        <span className="w-16">Number</span>
        <input className="w-24 rounded border px-1" defaultValue={room.number ?? ""} onBlur={(e) => e.target.value !== (room.number ?? "") && props.onRenumber(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-16">Name</span>
        <input className="flex-1 rounded border px-1" defaultValue={room.name ?? ""} placeholder="optional" onBlur={(e) => props.onChange({ name: e.target.value || undefined })} />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-16">Category</span>
        <select className="rounded border px-1" value={room.category} onChange={(e) => props.onChange({ category: e.target.value as RoomCategory })}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-16">Entered via</span>
        <select className="flex-1 rounded border px-1" value={room.enteredVia ?? ""} onChange={(e) => props.onChange({ enteredVia: e.target.value || undefined })}>
          <option value="">the corridor</option>
          {props.rooms
            .filter((x) => x.id !== room.id && x.enteredVia !== room.id)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.number ?? x.name ?? x.id}
              </option>
            ))}
        </select>
      </label>
      {room.group && <p className="text-xs text-neutral-500">Legend: {room.group}</p>}
      {room.category === "restroom" && (
        <div className="flex items-center gap-2">
          <select className="rounded border px-1" value={room.restroom?.gender ?? ""} onChange={(e) => props.onChange({ restroom: { gender: e.target.value as "men" | "women" | "all", accessible: room.restroom?.accessible ?? false } })}>
            <option value="" disabled>
              gender…
            </option>
            <option value="women">women</option>
            <option value="men">men</option>
            <option value="all">all-gender</option>
          </select>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={room.restroom?.accessible ?? false} onChange={(e) => props.onChange({ restroom: { gender: room.restroom?.gender ?? "all", accessible: e.target.checked } })} />
            accessible
          </label>
        </div>
      )}
      <div>
        <div className="flex items-center">
          <span className="font-medium">Doors</span>
          <button className="ml-auto text-blue-700 hover:underline" onClick={() => props.onTool("door")}>
            {room.doors.length ? "Move door (D)" : "Place door (D)"}
          </button>
          {room.doors.length > 0 && (
            <button className="ml-3 text-blue-700 hover:underline" onClick={() => props.onAddDoor()}>
              Add another (⇧D)
            </button>
          )}
        </div>
        <ul className="text-xs text-neutral-600">
          {room.doors.map((d, i) => (
            <li key={i} className="flex gap-2">
              {d.edgeId} t={d.t.toFixed(2)} {d.side} {d.confidence < 1 ? "(guess)" : "(set)"}
              <button className="ml-auto text-blue-700" onClick={() => props.onMoveDoor(i)}>
                move
              </button>
              <button className="text-red-700" onClick={() => props.onRemoveDoor(i)}>
                remove
              </button>
            </li>
          ))}
        </ul>
      </div>
      {props.suite.length > 0 && (
        <p className="text-xs">
          Shares its outline with{" "}
          {props.suite.map((s) => (
            <button key={s.id} className="mr-1 text-blue-700 hover:underline" onClick={() => props.onSelect(s.id)}>
              {s.number ?? s.id}
            </button>
          ))}
          — use Split (S) to give each its own outline.
        </p>
      )}
      <div className="flex gap-3">
        <button className="text-blue-700 hover:underline" onClick={() => props.onTool("split")}>
          Split (S)
        </button>
        <button className="text-red-700 hover:underline" onClick={props.onDelete}>
          Delete room
        </button>
      </div>
    </div>
  );
}

function pts(poly: Point[]): string {
  return poly.map(([x, y]) => `${x},${y}`).join(" ");
}

function round(poly: Point[]): Point[] {
  return poly.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

