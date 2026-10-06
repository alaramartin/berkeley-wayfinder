"use client";
/** What you can do to the thing you tapped. Every action records one edit; none changes the data directly. */
import type { Access, PatchOp } from "@wf/schema";
import { useState } from "react";
import { type FieldView, type Selection } from "@/lib/field/model";

const ACCESS: { value: Access; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "card", label: "Card only" },
  { value: "hours", label: "Hours only" },
  { value: "locked", label: "Locked" },
];

const btn = "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium active:bg-neutral-100";
const primary = "rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white active:bg-neutral-700";

export function Inspector({
  view,
  selection,
  levelName,
  onOp,
  onMove,
  onAdd,
  onClose,
}: {
  view: FieldView;
  selection: Selection;
  levelName: (levelId: string) => string;
  onOp: (op: PatchOp) => void;
  /** Start "tap where the door really is" for this door. */
  onMove: (roomId: string, doorIndex: number) => void;
  onAdd: (roomId: string) => void;
  onClose: () => void;
}) {
  const room = selection.kind === "door" || selection.kind === "room" ? view.data.rooms.find((r) => r.id === selection.roomId) : undefined;
  const fullRoom = view.levels.flatMap((l) => l.rooms).find((r) => r.id === room?.id);
  const [number, setNumber] = useState("");

  return (
    <div className="border-t border-neutral-200 bg-white p-4 text-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {room && fullRoom ? (
            <>
              <p className="text-base font-semibold">
                Room {room.number ?? fullRoom.name ?? room.id}
                {selection.kind === "door" && room.doors.length > 1 ? ` · door ${selection.doorIndex + 1} of ${room.doors.length}` : ""}
              </p>
              <p className="text-neutral-500">
                {levelName(fullRoom.levelId)} · {fullRoom.category.replace("-", " ")}
              </p>
            </>
          ) : null}
          {selection.kind === "entrance" && <p className="text-base font-semibold">{view.building.entrances.find((e) => e.id === selection.entranceId)?.name}</p>}
          {selection.kind === "shaft" && <p className="text-base font-semibold">{shaftName(view, selection.shaftId)}</p>}
          {selection.kind === "edge" && <p className="text-base font-semibold">Corridor {selection.edgeId.replace(/^.*-e/, "e")}</p>}
        </div>
        <button className={btn} onClick={onClose}>
          Done
        </button>
      </div>

      {selection.kind === "door" && room && (
        <div className="space-y-3">
          <p className={room.doors[selection.doorIndex]?.verified ? "text-green-700" : "text-amber-700"}>
            {room.doors[selection.doorIndex]?.verified ? "Confirmed on the walk." : "Guessed from the placard. Is the door where the orange dot is?"}
          </p>
          <div className="flex flex-wrap gap-2">
            {!room.doors[selection.doorIndex]?.verified && (
              <button className={primary} onClick={() => onOp({ op: "confirmDoor", roomId: room.id, doorIndex: selection.doorIndex })}>
                Yes, it's right
              </button>
            )}
            <button className={btn} onClick={() => onMove(room.id, selection.doorIndex)}>
              Move it
            </button>
            <button className={btn} onClick={() => onAdd(room.id)}>
              Add another door
            </button>
          </div>
        </div>
      )}

      {selection.kind === "room" && room && fullRoom && (
        <div className="space-y-3">
          <p className="text-neutral-600">{room.doors.length ? `${room.doors.length} door${room.doors.length > 1 ? "s" : ""} recorded.` : "No door recorded."}</p>
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={() => onAdd(room.id)}>
              {room.doors.length ? "Add another door" : "Add its door"}
            </button>
          </div>
        </div>
      )}

      {room && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = number.trim();
            if (!value) return;
            onOp({ op: "setRoomNumber", roomId: room.id, number: value });
            setNumber("");
          }}
        >
          <input className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2" placeholder="Wrong number? Type the real one" value={number} onChange={(e) => setNumber(e.target.value)} />
          <button className={btn} type="submit" disabled={!number.trim()}>
            Fix number
          </button>
        </form>
      )}

      {selection.kind === "entrance" && (() => {
        const e = view.building.entrances.find((x) => x.id === selection.entranceId);
        if (!e) return null;
        return (
          <div className="space-y-3">
            <p className={e.verified ? "text-green-700" : "text-amber-700"}>{e.verified ? "Confirmed on the walk." : "Guessed from an exit sign. Is this a real entrance?"}</p>
            <p>Can a wheelchair get in without steps?</p>
            <div className="flex gap-2">
              <button className={e.verified && e.accessible ? primary : btn} onClick={() => onOp({ op: "confirmEntrance", entranceId: e.id, accessible: true })}>
                Yes, step-free
              </button>
              <button className={e.verified && !e.accessible ? primary : btn} onClick={() => onOp({ op: "confirmEntrance", entranceId: e.id, accessible: false })}>
                No, there are steps
              </button>
            </div>
          </div>
        );
      })()}

      {selection.kind === "shaft" && <ShaftEditor view={view} shaftId={selection.shaftId} levelName={levelName} onOp={onOp} />}

      {selection.kind === "edge" && (() => {
        const edge = view.data.edges.find((x) => x.id === selection.edgeId);
        if (!edge) return null;
        return (
          <div className="space-y-3">
            <p>Can everyone walk through this corridor?</p>
            <div className="flex flex-wrap gap-2">
              {ACCESS.map((a) => (
                <button key={a.value} className={(edge.access ?? "open") === a.value && edge.verified ? primary : btn} onClick={() => onOp({ op: "setEdgeAccess", edgeId: edge.id, access: a.value })}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function shaftName(view: FieldView, id: string): string {
  const s = view.building.shafts.find((x) => x.id === id);
  if (!s) return id;
  return s.name ?? `${s.kind === "stair" ? "Stair" : "Lift"} ${id.replace(/^.*-shaft-/, "")}`;
}

function ShaftEditor({ view, shaftId, levelName, onOp }: { view: FieldView; shaftId: string; levelName: (id: string) => string; onOp: (op: PatchOp) => void }) {
  const shaft = view.building.shafts.find((s) => s.id === shaftId);
  const nodeLevel = new Map(view.levels.flatMap((l) => l.nodes.map((n) => [n.id, l.id] as const)));
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  if (!shaft) return null;
  if (shaft.kind !== "stair") return <p className="text-neutral-600">A lift: nothing to count here. Mark which entrances and corridors are step-free instead.</p>;
  return (
    <div className="space-y-3">
      <p className="text-neutral-600">Count the steps of each flight, walking up. Count every step from one floor to the next, landings included.</p>
      {shaft.nodeIds.slice(0, -1).map((id, i) => {
        const from = levelName(nodeLevel.get(id) ?? "");
        const to = levelName(nodeLevel.get(shaft.nodeIds[i + 1]!) ?? "");
        const saved = shaft.stepCounts?.[i];
        return (
          <form
            key={id}
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number.parseInt(drafts[i] ?? "", 10);
              if (!Number.isFinite(n) || n < 0) return;
              onOp({ op: "setStepCount", shaftId: shaft.id, index: i, steps: n });
              setDrafts((d) => ({ ...d, [i]: "" }));
            }}
          >
            <span className="w-40 shrink-0">
              {from} → {to}
            </span>
            <input
              inputMode="numeric"
              className="w-20 rounded-lg border border-neutral-300 px-3 py-2"
              placeholder={saved === null || saved === undefined ? "steps" : String(saved)}
              value={drafts[i] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value.replace(/\D/g, "") }))}
            />
            <button className={btn} type="submit" disabled={!drafts[i]}>
              Save
            </button>
            {saved !== null && saved !== undefined && <span className="text-green-700">{saved} steps</span>}
          </form>
        );
      })}
    </div>
  );
}
