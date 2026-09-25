"use client";
/** Everything the building page does: load data, keep state in the URL, route, and draw. */
import { instructions, nearest, route, summary as routeSummary } from "@wf/routing";
import type { Instruction } from "@wf/routing";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Legend } from "@/components/Legend";
import { RoutePanel } from "@/components/RoutePanel";
import { routeGeometry } from "@/lib/route-geometry";
import { type BuildingData, loadBuilding } from "@/lib/data";
import type { SearchResult } from "@/lib/search";
import { type NavState, type ViewMode, readState, writeState } from "@/lib/url";

// The 3D scene is client-only and heavy, so it loads after the panel is usable.
const Scene = dynamic(() => import("@/components/Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-neutral-500">Loading the building…</div>,
});

export function BuildingView({ buildingId }: { buildingId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const state = useMemo(() => readState(new URLSearchParams(params.toString())), [params]);
  const [data, setData] = useState<BuildingData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadBuilding(buildingId)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, [buildingId]);

  const update = useCallback(
    (next: Partial<NavState>) => {
      // Read the live URL rather than this render's state: two picks in quick succession would
      // otherwise both build on the same stale snapshot, and the first would be lost.
      const current = readState(new URLSearchParams(window.location.search));
      const query = writeState({ ...current, ...next }).toString();
      router.replace(query ? `?${query}` : "?", { scroll: false });
    },
    [router],
  );

  const labelFor = useCallback(
    (id: string | null): string | null => {
      if (!id || !data) return null;
      const room = data.graph.rooms.get(id);
      if (room) return room.number ? `${room.number}${room.name ? ` · ${room.name}` : ""}` : (room.name ?? id);
      return data.building.entrances.find((e) => e.id === id)?.name ?? id;
    },
    [data],
  );

  /** A shared link can name a place this building doesn't have; say so plainly. */
  const unknown = useMemo(() => {
    if (!data) return null;
    const known = (id: string | null) => !id || data.graph.rooms.has(id) || data.building.entrances.some((e) => e.id === id);
    const missing = [state.from, state.to].filter((id) => id && !known(id));
    return missing.length ? `This link points to somewhere we don't have in ${data.building.name}: ${missing.join(", ")}.` : null;
  }, [data, state.from, state.to]);

  const result = useMemo(() => {
    if (!data || !state.from || unknown) return null;
    const from = data.graph.rooms.has(state.from) ? ({ type: "room", id: state.from } as const) : ({ type: "entrance", id: state.from } as const);
    const opts = { accessible: state.accessible };
    if (state.nearest) {
      const found = nearest(data.graph, from, state.nearest, opts);
      return found.ok ? { route: found.route, error: null, toLabel: found.roomId ? labelFor(found.roomId) : "Nearest" } : { route: null, error: found.error, toLabel: null };
    }
    if (!state.to) return null;
    const to = data.graph.rooms.has(state.to) ? ({ type: "room", id: state.to } as const) : ({ type: "entrance", id: state.to } as const);
    const found = route(data.graph, from, to, opts);
    return found.ok ? { route: found.route, error: null, toLabel: labelFor(state.to) } : { route: null, error: found.error, toLabel: labelFor(state.to) };
  }, [data, state.from, state.to, state.nearest, state.accessible, labelFor, unknown]);

  const steps: Instruction[] = useMemo(() => (data && result?.route ? instructions(data.graph, result.route) : []), [data, result]);
  const geometry = useMemo(() => (result?.route ? routeGeometry(result.route) : null), [result]);

  /**
   * The guide: show the whole building for a moment, fly down to the first step, then follow the
   * steps. Dragging the scene hands control back; "Resume guide" picks it up again. This is React
   * state, not URL state — a shared link should open on the overview, not mid-flight.
   */
  const [guide, setGuide] = useState<"off" | "overview" | "flying" | "following" | "manual">("off");
  const [stepIndex, setStepIndex] = useState(0);
  const [flightRequest, setFlightRequest] = useState<{ kind: "overview" | "step"; step: number; ms: number; key: number; immediate?: boolean } | null>(null);
  const flightKey = useRef(0);

  const flyTo = useCallback((kind: "overview" | "step", step: number, ms: number, immediate = false) => {
    flightKey.current += 1;
    setFlightRequest({ kind, step, ms, key: flightKey.current, immediate });
  }, []);

  /** A new route restarts the guide from the overview. */
  const signature = `${state.from ?? ""}|${state.to ?? ""}|${state.nearest ?? ""}|${state.accessible}`;
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    // Only remember a signature once the route is actually in hand: the first pass happens while the
    // building is still loading, and recording it there would skip the guide for that route.
    if (!geometry || steps.length === 0) {
      if (lastSignature.current !== null) {
        lastSignature.current = null;
        setGuide("off");
        flyTo("overview", 0, 0, true);
      }
      return;
    }
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    // The guide starts on the first step with a direction of travel; "Start at 120" has none.
    const first = firstWalkStep(steps);
    setStepIndex(first);
    setGuide("overview");
    flyTo("overview", 0, 0, true);
    const timer = window.setTimeout(() => {
      setGuide("flying");
      flyTo("step", first, 1600);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [signature, geometry, steps, flyTo]);

  const goToStep = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(0, index), Math.max(0, steps.length - 1));
      setStepIndex(clamped);
      setGuide("following");
      flyTo("step", clamped, 900);
      const step = steps[clamped];
      if (step) update({ level: step.levelId });
    },
    [steps, flyTo, update],
  );

  const pick = (which: "from" | "to") => (r: SearchResult) => {
    if (r.target.type === "nearest") update({ nearest: r.target.kind, to: null });
    else if (which === "from") update({ from: r.target.id });
    else update({ to: r.target.id, nearest: null });
  };

  if (loadError) return <main className="p-6 text-red-700">Could not load {buildingId}: {loadError}</main>;
  if (!data) return <main className="p-6 text-neutral-500">Loading…</main>;

  const panel = (
    <RoutePanel
      data={data}
      fromLabel={labelFor(state.from)}
      toLabel={state.nearest ? (result?.toLabel ?? "Nearest") : labelFor(state.to)}
      accessible={state.accessible}
      view={state.view}
      summary={result?.route ? routeSummary(result.route) : null}
      steps={steps}
      error={unknown ?? result?.error ?? null}
      onPickFrom={pick("from")}
      onPickTo={pick("to")}
      onClearFrom={() => update({ from: null })}
      onClearTo={() => update({ to: null, nearest: null })}
      onSwap={() => update({ from: state.to, to: state.from, nearest: null })}
      onToggleAccessible={() => update({ accessible: !state.accessible })}
      onSetView={(v: ViewMode) => update({ view: v })}
      onStep={(_step, index) => goToStep(index)}
      activeStep={guide === "off" ? null : stepIndex}
      onPrev={() => goToStep(stepIndex - 1)}
      onNext={() => goToStep(stepIndex + 1)}
      onOverview={() => {
        setGuide("overview");
        flyTo("overview", 0, 900);
      }}
    />
  );

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      <div className="relative min-h-0 flex-1">
        <Scene
          data={data}
          view={state.view}
          routeLevels={result?.route?.levelIds ?? []}
          geometry={geometry}
          activeStep={guide === "off" || guide === "overview" ? null : stepIndex}
          flightRequest={flightRequest}
          onFlightArrive={() => setGuide((g) => (g === "flying" ? "following" : g))}
          onTakeover={() => setGuide((g) => (g === "off" ? g : "manual"))}
          focusLevel={state.level}
          onSelectLevel={(id) => update({ level: state.level === id ? null : id })}
        />
        <Legend levels={data.levels} focusLevel={state.level} />
        {state.level && (
          <button onClick={() => update({ level: null })} className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1.5 text-sm shadow">
            Showing Level {data.levels.find((l) => l.id === state.level)?.displayName ?? state.level} · show all
          </button>
        )}
        {guide === "manual" && steps.length > 0 && (
          <button
            onClick={() => goToStep(stepIndex)}
            className="absolute bottom-3 left-3 rounded-full bg-neutral-900/90 px-3 py-1.5 text-sm text-white shadow"
          >
            Resume guide
          </button>
        )}
      </div>
      <aside className="max-h-[55dvh] shrink-0 border-t border-neutral-200 bg-white md:max-h-none md:w-96 md:border-l md:border-t-0">{panel}</aside>
    </main>
  );
}

/** The first step worth flying to: skip the "Start at 120" line, which has no direction of travel. */
function firstWalkStep(steps: Instruction[]): number {
  const index = steps.findIndex((s) => s.kind !== "start");
  return index < 0 ? 0 : index;
}
