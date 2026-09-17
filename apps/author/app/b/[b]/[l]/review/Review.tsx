"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import type { Proposal, ReviewItem, ReviewQueue } from "@wf/schema";
import { api, fileUrl, type LevelSummary } from "@/lib/client";
import { applyAnswer, type Answer } from "@/lib/review";

const KIND_TITLES: Record<ReviewItem["kind"], string> = {
  "room-number": "What number is this room?",
  "restroom-gender": "Which restroom is this?",
  alias: "Is this directory entry right?",
  icon: "Is this icon really there?",
};

export function Review({ building, level }: { building: string; level: string }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [levels, setLevels] = useState<LevelSummary[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.proposal(building, level), api.queue(building, level), api.building(building)]).then(
      ([p, q, b]) => {
        setProposal(p);
        setQueue(q);
        setLevels(b.levels);
        const firstOpen = q.items.findIndex((i) => !i.resolved);
        setIndex(firstOpen === -1 ? 0 : firstOpen);
      },
      (e: Error) => setError(e.message),
    );
  }, [building, level]);

  const open = useMemo(() => queue?.items.filter((i) => !i.resolved).length ?? 0, [queue]);
  const item = queue?.items[index];

  const answer = useCallback(
    async (a: Answer) => {
      if (!proposal || !queue || !item) return;
      setSaving(true);
      try {
        const { proposal: nextP, item: resolved, conflict } = applyAnswer(proposal, item, a);
        if (conflict) {
          setError(conflict);
          return;
        }
        const nextQ = { ...queue, items: queue.items.map((i) => (i.id === item.id ? resolved : i)) };
        const savedP = await api.saveProposal(building, level, nextP);
        await api.saveQueue(building, level, nextQ);
        setProposal(savedP);
        setQueue(nextQ);
        const after = nextQ.items.findIndex((i, j) => j > index && !i.resolved);
        const wrap = nextQ.items.findIndex((i) => !i.resolved);
        setIndex(after !== -1 ? after : wrap !== -1 ? wrap : index);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [proposal, queue, item, building, level, index],
  );

  if (error && !queue) return <p className="p-6 text-red-700">{error}</p>;
  if (!queue || !proposal) return <p className="p-6 text-neutral-500">Loading…</p>;

  const nextLevel = levels.find((l) => l.id !== level && l.openReview > 0);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-baseline gap-3">
        <Link href={`/b/${building}`} className="text-blue-700 hover:underline">
          {building}
        </Link>
        <h1 className="text-lg font-semibold">Level {level}: review</h1>
        <span className="text-sm text-neutral-500">
          {queue.items.length - open}/{queue.items.length} resolved
        </span>
        <Link href={`/b/${building}/${level}/edit`} className="ml-auto text-sm text-blue-700 hover:underline">
          Open editor →
        </Link>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-neutral-200">
        <div className="h-full bg-green-600" style={{ width: `${queue.items.length ? (100 * (queue.items.length - open)) / queue.items.length : 100}%` }} />
      </div>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {open === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
          <CheckCircle size={20} />
          <span>Everything on this level is reviewed.</span>
          <span className="ml-auto flex gap-3 text-sm">
            <Link className="underline" href={`/b/${building}/${level}/edit`}>
              Fix remaining blockers in the editor
            </Link>
            {nextLevel && (
              <Link className="underline" href={`/b/${building}/${nextLevel.id}/review`}>
                Next: level {nextLevel.id} ({nextLevel.openReview})
              </Link>
            )}
          </span>
        </div>
      )}

      {item && (
        <ItemCard
          key={item.id + (item.resolved?.at ?? "")}
          building={building}
          level={level}
          item={item}
          proposal={proposal}
          disabled={saving}
          onAnswer={answer}
          onSkip={(dir) => setIndex((i) => (i + dir + queue.items.length) % queue.items.length)}
        />
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-neutral-600">All items</summary>
        <ul className="mt-2 divide-y divide-neutral-100 rounded border border-neutral-200 bg-white">
          {queue.items.map((it, i) => (
            <li key={it.id}>
              <button className={`flex w-full gap-2 px-3 py-1.5 text-left hover:bg-neutral-50 ${i === index ? "bg-blue-50" : ""}`} onClick={() => setIndex(i)}>
                <span className="w-32 text-neutral-500">{it.kind}</span>
                <span className="font-mono text-xs">{it.targetId}</span>
                <span className="ml-auto">{it.resolved ? `✓ ${it.resolved.value ?? "rejected"}` : "open"}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}

function ItemCard(props: {
  building: string;
  level: string;
  item: ReviewItem;
  proposal: Proposal;
  disabled: boolean;
  onAnswer: (a: Answer) => void;
  onSkip: (dir: 1 | -1) => void;
}) {
  const { item, proposal } = props;
  const top = item.candidates[0]?.value ?? "";
  const [value, setValue] = useState(item.resolved?.value ?? (item.kind === "restroom-gender" ? top || "women" : top));
  const [accessible, setAccessible] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const related = proposal.rooms.filter((r) => r.id === item.targetId || r.regionId === item.targetId);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (props.disabled) return;
      if (e.key === "Tab") {
        e.preventDefault();
        props.onSkip(e.shiftKey ? -1 : 1);
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        props.onAnswer({ value: null });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (item.kind === "restroom-gender") props.onAnswer({ value, accessible });
        else if (item.kind === "icon") props.onAnswer({ value: top });
        else if (value.trim()) props.onAnswer({ value: value.trim() });
      } else if (item.kind === "restroom-gender" && !(e.target instanceof HTMLInputElement)) {
        const map: Record<string, string> = { w: "women", m: "men", a: "all" };
        if (map[e.key]) setValue(map[e.key]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props, item.kind, value, accessible, top]);

  return (
    <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold">{KIND_TITLES[item.kind]}</h2>
        {item.resolved && <span className="text-xs text-green-700">answered: {item.resolved.value ?? "rejected"} (answer again to change)</span>}
      </div>
      {item.crop && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl(props.building, props.level, item.crop)} alt="crop from the placard" className="max-h-80 rounded border border-neutral-200 bg-neutral-100 object-contain" />
      )}
      {related.length > 0 && (
        <p className="text-sm text-neutral-600">
          Region {item.targetId} · category {related[0]!.category}
          {related.some((r) => r.number) && ` · already has ${related.map((r) => r.number).filter(Boolean).join(", ")}`}
        </p>
      )}
      {item.candidates.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {item.candidates.map((c) => (
            <button key={c.value} className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50" onClick={() => setValue(c.value)}>
              {c.value} <span className="text-neutral-400">{Math.round(c.confidence * 100)}%</span>
            </button>
          ))}
        </div>
      )}

      {item.kind === "restroom-gender" && (
        <p className="text-xs text-neutral-500">If this outline covers more than one restroom, skip it (Tab) and split it in the editor first.</p>
      )}
      {item.kind === "restroom-gender" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[
            ["women", "W"],
            ["men", "M"],
            ["all", "A"],
          ].map(([g, k]) => (
            <button key={g} onClick={() => setValue(g!)} className={`rounded border px-3 py-1.5 ${value === g ? "border-blue-600 bg-blue-50" : "border-neutral-300"}`}>
              {g === "all" ? "all-gender" : g} <kbd className="text-xs text-neutral-400">{k}</kbd>
            </button>
          ))}
          <label className="ml-3 flex items-center gap-1">
            <input type="checkbox" checked={accessible} onChange={(e) => setAccessible(e.target.checked)} /> wheelchair accessible
          </label>
        </div>
      ) : item.kind === "icon" ? (
        <p className="text-sm">
          Detected: <b>{top}</b>
        </p>
      ) : (
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={item.kind === "alias" ? "Name = room number" : "Room number"}
          className="w-full rounded border border-neutral-300 px-3 py-2 font-mono text-lg"
        />
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <button
          disabled={props.disabled}
          className="rounded bg-blue-700 px-3 py-1.5 text-white disabled:opacity-50"
          onClick={() => props.onAnswer(item.kind === "restroom-gender" ? { value, accessible } : { value: item.kind === "icon" ? top : value.trim() })}
        >
          {item.kind === "icon" ? "Keep" : "Accept"} <kbd className="text-xs opacity-70">Enter</kbd>
        </button>
        <button disabled={props.disabled} className="rounded border border-neutral-300 px-3 py-1.5 disabled:opacity-50" onClick={() => props.onAnswer({ value: null })}>
          {item.kind === "room-number" ? "Not a room" : item.kind === "icon" ? "Remove" : "Reject"} <kbd className="text-xs text-neutral-400">⇧Enter</kbd>
        </button>
        <button className="rounded border border-neutral-300 px-3 py-1.5" onClick={() => props.onSkip(1)}>
          Skip <kbd className="text-xs text-neutral-400">Tab</kbd>
        </button>
      </div>
    </section>
  );
}
