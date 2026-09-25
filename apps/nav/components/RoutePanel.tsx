"use client";
/** Bottom sheet on a phone, side panel on a desktop: the fields, the toggles and the steps. */
import { ArrowsDownUp, CaretLeft, CaretRight, Cube, PersonSimpleCircle, Stack, Warning } from "@phosphor-icons/react";
import type { Instruction } from "@wf/routing";
import type { BuildingData } from "@/lib/data";
import type { SearchResult } from "@/lib/search";
import type { ViewMode } from "@/lib/url";
import { SearchField } from "./SearchField";

export function RoutePanel({
  data,
  fromLabel,
  toLabel,
  accessible,
  view,
  summary,
  steps,
  error,
  onPickFrom,
  onPickTo,
  onClearFrom,
  onClearTo,
  onSwap,
  onToggleAccessible,
  onSetView,
  onStep,
  activeStep,
  onPrev,
  onNext,
  onOverview,
}: {
  data: BuildingData;
  fromLabel: string | null;
  toLabel: string | null;
  accessible: boolean;
  view: ViewMode;
  summary: string | null;
  steps: Instruction[];
  error: string | null;
  onPickFrom: (r: SearchResult) => void;
  onPickTo: (r: SearchResult) => void;
  onClearFrom: () => void;
  onClearTo: () => void;
  onSwap: () => void;
  onToggleAccessible: () => void;
  onSetView: (v: ViewMode) => void;
  onStep: (step: Instruction, index: number) => void;
  /** Step the guide is on, or null when the guide is off. */
  activeStep: number | null;
  onPrev: () => void;
  onNext: () => void;
  onOverview: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <SearchField data={data} label="From" value={fromLabel} placeholder="Room, entrance…" onPick={onPickFrom} onClear={onClearFrom} />
          <SearchField data={data} label="To" value={toLabel} placeholder="Room, or “nearest restroom”" onPick={onPickTo} onClear={onClearTo} />
        </div>
        <button
          aria-label="Swap start and destination"
          onClick={onSwap}
          className="mb-1 rounded-lg border border-neutral-300 p-2 text-neutral-600 hover:bg-neutral-50"
        >
          <ArrowsDownUp size={18} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onToggleAccessible}
          aria-pressed={accessible}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
            accessible ? "border-berkeley-blue bg-berkeley-blue text-white" : "border-neutral-300 text-neutral-700"
          }`}
        >
          <PersonSimpleCircle size={16} weight={accessible ? "fill" : "regular"} />
          Step-free
        </button>
        <div className="ml-auto flex overflow-hidden rounded-full border border-neutral-300">
          {(["exploded", "solid"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onSetView(mode)}
              aria-pressed={view === mode}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${view === mode ? "bg-neutral-900 text-white" : "text-neutral-700"}`}
            >
              {mode === "exploded" ? <Stack size={16} /> : <Cube size={16} />}
              {mode === "exploded" ? "Exploded" : "Solid"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <Warning size={18} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {summary && (
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-neutral-700">{summary}</p>
          <button onClick={onOverview} className="ml-auto rounded-full border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50">
            Whole route
          </button>
        </div>
      )}

      {steps.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <button onClick={onPrev} disabled={activeStep === null || activeStep <= 0} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40">
              <CaretLeft size={14} className="inline" /> Prev
            </button>
            <span className="text-xs text-neutral-500">{activeStep === null ? `${steps.length} steps` : `Step ${activeStep + 1} of ${steps.length}`}</span>
            <button
              onClick={onNext}
              disabled={activeStep !== null && activeStep >= steps.length - 1}
              className="ml-auto rounded-lg border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Next <CaretRight size={14} className="inline" />
            </button>
          </div>
          <ol className="space-y-1">
            {steps.map((step, i) => (
              <li key={`${step.nodeId}-${i}`}>
                <button
                  onClick={() => onStep(step, i)}
                  className={`flex w-full gap-3 rounded-lg px-2 py-2 text-left hover:bg-neutral-100 ${i === activeStep ? "bg-berkeley-blue/10 ring-1 ring-berkeley-blue/30" : ""}`}
                >
                  <span className="mt-0.5 w-5 shrink-0 text-xs text-neutral-400">{i + 1}</span>
                  <span className="text-sm">{step.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}

      {!summary && !error && (
        <p className="text-sm text-neutral-500">
          Pick a start and a destination. Distances are approximate, and doors marked unconfirmed still need a check in the building.
        </p>
      )}
    </div>
  );
}
