"use client";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildingData } from "@/lib/data";
import { type SearchResult, buildIndex, search } from "@/lib/search";

export function SearchField({
  data,
  label,
  value,
  placeholder,
  onPick,
  onClear,
}: {
  data: BuildingData;
  label: string;
  /** What is currently chosen, shown when the field isn't being edited. */
  value: string | null;
  placeholder: string;
  onPick: (result: SearchResult) => void;
  onClear: () => void;
}) {
  const index = useMemo(() => buildIndex(data), [data]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const results = useMemo(() => (open ? search(index, query) : []), [index, query, open]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const choose = (result: SearchResult | undefined) => {
    if (!result) return;
    onPick(result);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <label className="mb-1 block text-xs font-medium text-neutral-500">{label}</label>
      <div className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 py-2 focus-within:border-berkeley-blue">
        <MagnifyingGlass size={18} className="shrink-0 text-neutral-400" />
        <input
          className="min-w-0 flex-1 bg-transparent text-base outline-none"
          value={open ? query : (value ?? "")}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setHighlight((h) => Math.min(h + 1, results.length - 1));
            else if (e.key === "ArrowUp") setHighlight((h) => Math.max(0, h - 1));
            else if (e.key === "Enter") choose(results[highlight]);
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {value && !open && (
          <button aria-label={`Clear ${label}`} onClick={onClear} className="shrink-0 text-neutral-400 hover:text-neutral-700">
            <X size={16} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
          {results.map((result, i) => (
            <li key={`${result.label}-${i}`}>
              <button
                className={`flex w-full flex-col items-start px-3 py-2 text-left ${i === highlight ? "bg-neutral-100" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(result)}
              >
                <span className="text-sm font-medium">{result.label}</span>
                {result.detail && <span className="text-xs text-neutral-500">{result.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
