"use client";
/**
 * The walk: confirm what the placards only suggested. Everything here records an edit on this phone;
 * nothing is sent anywhere. At the end the edits leave as one patch file for the author tool to review.
 *
 * Deliberately plain. M6 redesigns how the app looks; this has to work with cold hands in a corridor.
 */
import { makePatch } from "@wf/field";
import type { PatchOp, Point } from "@wf/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BuildingData, listBuildings, loadBuilding } from "@/lib/data";
import { baseFieldData, buildView, nearestCorridor, pickAt, toCheck, type Selection } from "@/lib/field/model";
import { type OfflineState, registerOffline } from "@/lib/field/offline";
import { type OpStore, type StoredOp, openStore } from "@/lib/field/store";
import { FieldMap } from "./FieldMap";
import { Inspector } from "./Inspector";

type Tab = "map" | "check" | "edits";
type Mode = { kind: "move"; roomId: string; doorIndex: number } | { kind: "add"; roomId: string } | { kind: "note" } | null;

const btn = "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium active:bg-neutral-100";
const primary = "rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white active:bg-neutral-700";

export function FieldApp() {
  const [base, setBase] = useState<BuildingData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [store, setStore] = useState<OpStore | null>(null);
  const [stored, setStored] = useState<StoredOp[]>([]);
  const [tab, setTab] = useState<Tab>("map");
  const [levelId, setLevelId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [focus, setFocus] = useState<{ point: Point; key: number } | null>(null);
  const [lastTap, setLastTap] = useState<Point | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState<OfflineState>("starting");
  const [author, setAuthor] = useState("");
  const [noteText, setNoteText] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const focusKey = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const wanted = new URLSearchParams(window.location.search).get("b");
        const id = wanted ?? (await listBuildings())[0];
        if (!id) throw new Error("no building data");
        const data = await loadBuilding(id);
        const opStore = await openStore(id);
        const ops = await opStore.list();
        if (!alive) return;
        setBase(data);
        setStore(opStore);
        setStored(ops);
        setLevelId(data.levels[0]?.id ?? null);
        setAuthor(localStorage.getItem("wf-field-author") ?? "");
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    registerOffline(setOffline);
    return () => {
      alive = false;
    };
  }, []);

  const ops = useMemo(() => stored.map((s) => s.op), [stored]);
  const view = useMemo(() => (base ? buildView(base, ops) : null), [base, ops]);
  const check = useMemo(() => (view ? toCheck(view) : null), [view]);
  const level = view?.levels.find((l) => l.id === levelId) ?? null;
  const levelName = useCallback((id: string) => view?.levels.find((l) => l.id === id)?.displayName ?? id, [view]);

  const record = useCallback(
    async (op: PatchOp) => {
      if (!store) return;
      const saved = await store.add(op);
      setStored((s) => [...s, saved]);
    },
    [store],
  );

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 3500);
  };

  const onTap = (p: Point, reachM: number) => {
    if (!view || !level) return;
    setLastTap(p);
    if (mode?.kind === "move" || mode?.kind === "add") {
      const hit = nearestCorridor(level, p);
      if (!hit || hit.distance > 8) return flash("Tap closer to a corridor.");
      void record(
        mode.kind === "move"
          ? { op: "moveDoor", roomId: mode.roomId, doorIndex: mode.doorIndex, edgeId: hit.edgeId, t: hit.t, side: hit.side }
          : { op: "addDoor", roomId: mode.roomId, edgeId: hit.edgeId, t: hit.t, side: hit.side },
      );
      setSelection(mode.kind === "move" ? { kind: "door", roomId: mode.roomId, doorIndex: mode.doorIndex } : { kind: "room", roomId: mode.roomId });
      setMode(null);
      return;
    }
    setSelection(pickAt(view, level.id, p, reachM));
  };

  const goTo = (levelOf: string, sel: Selection, point: Point | null) => {
    setLevelId(levelOf);
    setSelection(sel);
    setTab("map");
    if (point) {
      focusKey.current += 1;
      setFocus({ point, key: focusKey.current });
    }
  };

  const exportPatch = async () => {
    if (!base) return;
    const patch = makePatch(base.building.id, baseFieldData(base), ops, author.trim() || undefined);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const name = `${base.building.id}-field-${stamp}.json`;
    const file = new File([JSON.stringify(patch, null, 2)], name, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return flash("Shared.");
      }
    } catch (e) {
      // The share sheet being dismissed is not an error; fall through to a download only if it failed.
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    flash(`Saved ${name} to this phone's downloads.`);
  };

  if (loadError) return <main className="p-6 text-red-700">Could not load the building: {loadError}</main>;
  if (!base || !view || !check || !level || !levelId) return <main className="p-6 text-neutral-500">Loading…</main>;

  const prompt =
    mode?.kind === "move" ? "Tap the corridor where the door really is." : mode?.kind === "add" ? "Tap the corridor where the extra door is." : mode?.kind === "note" ? "Tap the spot the note is about." : null;

  return (
    <main className="flex h-dvh flex-col bg-white text-neutral-900">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{base.building.name} · field</p>
          <p className="text-xs text-neutral-500">
            {check.confirmed}/{check.total} doors confirmed · {stored.length} edit{stored.length === 1 ? "" : "s"} saved ·{" "}
            {offline === "ready" ? "works offline" : offline === "starting" ? "getting ready for offline…" : offline === "unsupported" ? "offline needs https" : "offline not available"}
            {store?.kind === "memory" ? " · edits will be lost on reload" : ""}
          </p>
        </div>
      </header>

      <nav className="flex border-b border-neutral-200 text-sm">
        {(
          [
            ["map", "Map"],
            ["check", `To check (${check.doors.length + check.entrances.length + check.stairs.length})`],
            ["edits", `Edits (${stored.length})`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`flex-1 px-3 py-2 font-medium ${tab === id ? "border-b-2 border-neutral-900" : "text-neutral-500"}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {message && <p className="bg-neutral-900 px-3 py-2 text-center text-sm text-white">{message}</p>}

      {tab === "map" && (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-neutral-200 px-2 py-2">
            {view.levels.map((l) => (
              <button key={l.id} className={`shrink-0 rounded-full border px-3 py-1 text-sm ${l.id === levelId ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`} onClick={() => { setLevelId(l.id); setSelection(null); }}>
                {l.displayName}
              </button>
            ))}
          </div>
          {prompt && (
            <div className="flex items-center justify-between gap-2 bg-blue-600 px-3 py-2 text-sm text-white">
              <span>{prompt}</span>
              <button className="rounded border border-white/60 px-2 py-1" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <FieldMap
              view={view}
              level={level}
              selection={selection}
              highlight={mode ? null : lastTap && !selection ? lastTap : null}
              focus={focus}
              onTap={(p, r) => {
                if (mode?.kind === "note") {
                  setLastTap(p);
                  setMode(null);
                  setTab("map");
                  return;
                }
                onTap(p, r);
              }}
            />
          </div>
          {selection && !mode && (
            <Inspector
              view={view}
              selection={selection}
              levelName={levelName}
              onOp={(op) => void record(op)}
              onMove={(roomId, doorIndex) => setMode({ kind: "move", roomId, doorIndex })}
              onAdd={(roomId) => setMode({ kind: "add", roomId })}
              onClose={() => setSelection(null)}
            />
          )}
          {!selection && !mode && (
            <form
              className="flex gap-2 border-t border-neutral-200 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const text = noteText.trim();
                if (!text) return;
                void record({ op: "note", levelId, ...(lastTap ? { at: lastTap } : {}), text });
                setNoteText("");
                flash("Note saved.");
              }}
            >
              <input className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder={lastTap ? "Note about the spot you tapped" : "Tap the map, then add a note"} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
              <button className={btn} type="submit" disabled={!noteText.trim()}>
                Add note
              </button>
            </form>
          )}
        </>
      )}

      {tab === "check" && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
          <Section title={`Stairs to count (${check.stairs.length})`} empty="Every stair is counted.">
            {check.stairs.map((s) => {
              const shaft = view.building.shafts.find((x) => x.id === s.shaftId)!;
              const node = shaft.nodeIds[0]!;
              const lv = view.levels.find((l) => l.nodes.some((n) => n.id === node));
              const n = lv?.nodes.find((x) => x.id === node);
              return (
                <Row key={s.shaftId} onClick={() => lv && goTo(lv.id, { kind: "shaft", shaftId: s.shaftId, nodeId: node }, n ? [n.x, n.y] : null)}>
                  {s.label} <span className="text-neutral-500">· {s.counted}/{s.flights} flights counted</span>
                </Row>
              );
            })}
          </Section>
          <Section title={`Entrances to confirm (${check.entrances.length})`} empty="Every entrance is confirmed.">
            {check.entrances.map((e) => {
              const entrance = view.building.entrances.find((x) => x.id === e.entranceId)!;
              const lv = view.levels.find((l) => l.nodes.some((n) => n.id === entrance.nodeId));
              const n = lv?.nodes.find((x) => x.id === entrance.nodeId);
              return (
                <Row key={e.entranceId} onClick={() => lv && goTo(lv.id, { kind: "entrance", entranceId: e.entranceId }, n ? [n.x, n.y] : null)}>
                  {e.label} <span className="text-neutral-500">· {lv ? lv.displayName : ""}</span>
                </Row>
              );
            })}
          </Section>
          {view.levels.map((l) => {
            const doors = check.doors.filter((d) => d.levelId === l.id);
            return (
              <Section key={l.id} title={`${l.displayName}: doors to confirm (${doors.length})`} empty="All confirmed.">
                {doors.map((d) => {
                  const room = l.rooms.find((r) => r.id === d.roomId)!;
                  const edge = l.edges.find((e) => e.id === room.doors[d.doorIndex]?.edgeId);
                  const point = edge?.polyline?.[Math.floor(edge.polyline.length / 2)] ?? null;
                  return (
                    <Row key={`${d.roomId}-${d.doorIndex}`} onClick={() => goTo(l.id, { kind: "door", roomId: d.roomId, doorIndex: d.doorIndex }, point)}>
                      Room {d.label}
                    </Row>
                  );
                })}
              </Section>
            );
          })}
        </div>
      )}

      {tab === "edits" && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
          <label className="mb-3 block">
            <span className="text-neutral-600">Your name (goes in the patch, optional)</span>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
              value={author}
              onChange={(e) => {
                setAuthor(e.target.value);
                localStorage.setItem("wf-field-author", e.target.value);
              }}
            />
          </label>
          <div className="mb-4 flex flex-wrap gap-2">
            <button className={primary} disabled={!stored.length} onClick={() => void exportPatch()}>
              Send patch ({stored.length})
            </button>
            {!confirmClear ? (
              <button className={btn} disabled={!stored.length} onClick={() => setConfirmClear(true)}>
                Clear all edits
              </button>
            ) : (
              <>
                <button
                  className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white"
                  onClick={async () => {
                    await store?.clear();
                    setStored([]);
                    setConfirmClear(false);
                  }}
                >
                  Yes, delete {stored.length} edit{stored.length === 1 ? "" : "s"}
                </button>
                <button className={btn} onClick={() => setConfirmClear(false)}>
                  Keep them
                </button>
              </>
            )}
          </div>
          {!stored.length && <p className="text-neutral-500">Nothing yet. Edits you make on the map appear here, and you can undo any of them.</p>}
          <ol className="space-y-2">
            {[...stored].reverse().map((s) => {
              const result = view.results[stored.indexOf(s)];
              return (
                <li key={s.id} className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 p-3">
                  <div className="min-w-0">
                    <p className="font-medium">{result?.summary ?? s.op.op}</p>
                    {result && result.status === "applied" && result.before !== result.after && (
                      <p className="text-neutral-500">
                        {result.before} → {result.after}
                      </p>
                    )}
                    {result?.status === "skipped" && <p className="text-red-700">Does not apply: {result.reason}</p>}
                  </div>
                  <button
                    className={btn}
                    onClick={async () => {
                      await store?.remove(s.id);
                      setStored((all) => all.filter((x) => x.id !== s.id));
                    }}
                  >
                    Undo
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </main>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children.length ? <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">{children}</ul> : <p className="text-neutral-500">{empty}</p>}
    </section>
  );
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button className="w-full px-3 py-3 text-left active:bg-neutral-100" onClick={onClick}>
        {children}
      </button>
    </li>
  );
}
