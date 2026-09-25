"use client";
/** The colour key, top-left over the scene. Collapsed to a chip on a phone. */
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import type { Level } from "@wf/schema";
import { useMemo, useState } from "react";
import { legendEntries } from "@/lib/scene";

export function Legend({ levels, focusLevel }: { levels: Level[]; focusLevel: string | null }) {
  const entries = useMemo(() => legendEntries(levels, focusLevel), [levels, focusLevel]);
  const [open, setOpen] = useState(false);
  if (!entries.length) return null;

  return (
    <div className="absolute left-3 top-3 max-w-[60%] rounded-xl bg-white/90 text-sm shadow backdrop-blur">
      <button className="flex w-full items-center gap-1.5 px-3 py-1.5 font-medium md:hidden" onClick={() => setOpen((o) => !o)}>
        Key {open ? <CaretUp size={14} /> : <CaretDown size={14} />}
      </button>
      <ul className={`${open ? "block" : "hidden"} px-3 pb-2 md:block md:pt-2`}>
        {entries.map((entry) => (
          <li key={entry.category} className="flex items-center gap-2 py-0.5">
            <span className="size-3 shrink-0 rounded" style={{ backgroundColor: entry.color }} />
            <span className="truncate text-neutral-700">{entry.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
