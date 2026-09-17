"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, CheckCircle, Circle, MapTrifold, Stack, Warning } from "@phosphor-icons/react";
import { api } from "@/lib/client";

type Data = Awaited<ReturnType<typeof api.building>>;

export function Overview({ building }: { building: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api.building(building).then(setData, (e: Error) => setError(e.message));
  }, [building]);
  useEffect(load, [load]);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setMessage(null);
    try {
      setMessage(await fn());
    } catch (e) {
      setMessage(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      load();
    }
  }

  if (error) return <p className="p-6 text-red-700">{error}</p>;
  if (!data) return <p className="p-6 text-neutral-500">Loading…</p>;
  const { config, levels, alignment, osm, building: canonical } = data;
  const ref = alignment.referenceLevel;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">{config.name}</h1>
        <span className="text-sm text-neutral-500">reference level {ref}</span>
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <h2 className="border-b border-neutral-200 px-4 py-2 text-sm font-semibold">1. Fix each level</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2">Level</th>
              <th>Rooms</th>
              <th>Review</th>
              <th>Corridor pieces</th>
              <th>Blockers</th>
              <th>Aligned</th>
              <th>Accepted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => (
              <tr key={l.id} className="border-t border-neutral-100 align-top">
                <td className="px-4 py-2 font-medium">
                  {l.displayName}
                  {!l.verified && <span className="ml-1 text-xs text-amber-700">(unverified)</span>}
                </td>
                <td>
                  {l.numberedRooms}/{l.rooms}
                </td>
                <td>{l.totalReview ? `${l.totalReview - l.openReview}/${l.totalReview}` : "—"}</td>
                <td className={l.components > 1 ? "text-amber-700" : ""}>{l.components}</td>
                <td className="max-w-xs py-2 text-xs">
                  {l.blockers.length ? (
                    <ul className="space-y-0.5 text-amber-800">
                      {l.blockers.map((x) => (
                        <li key={x} className="flex gap-1">
                          <Warning size={12} className="mt-0.5 shrink-0" />
                          {x}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-green-700">ready</span>
                  )}
                  {l.hasNewerAuto && <p className="mt-1 text-blue-700">newer pipeline output available (see editor)</p>}
                </td>
                <td>{l.aligned ? <CheckCircle className="text-green-600" /> : <Circle className="text-neutral-300" />}</td>
                <td>{l.accepted ? <CheckCircle className="text-green-600" /> : <Circle className="text-neutral-300" />}</td>
                <td className="space-x-3 whitespace-nowrap pr-4 text-right">
                  <Link className="text-blue-700 hover:underline" href={`/b/${building}/${l.id}/review`}>
                    Review{l.openReview ? ` (${l.openReview})` : ""}
                  </Link>
                  <Link className="text-blue-700 hover:underline" href={`/b/${building}/${l.id}/edit`}>
                    Edit
                  </Link>
                  <Link className="text-blue-700 hover:underline" href={`/b/${building}/${l.id}/rectify`}>
                    Corners
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Stack /> 2. Align levels to {ref}
          </h2>
          <p className="mb-3 text-sm text-neutral-600">{levels.filter((l) => l.aligned).length} of {levels.length} aligned.</p>
          <Link href={`/b/${building}/align`} className="text-sm text-blue-700 hover:underline">
            Open alignment →
          </Link>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <MapTrifold /> 3. Fit {ref} to OpenStreetMap
          </h2>
          <p className="mb-3 text-sm text-neutral-600">
            {osm ? `Footprint: way ${osm.wayId}, ${osm.ring.length} points.` : "Footprint not fetched."}{" "}
            {alignment.osm.transform ? `Fitted (rms ${alignment.osm.rms?.toFixed(2)} m).` : "Not fitted."}
          </p>
          <div className="flex gap-3 text-sm">
            <button
              className="text-blue-700 hover:underline disabled:text-neutral-400"
              disabled={!!busy}
              onClick={() => run("Fetch OSM", async () => `Fetched way ${(await api.fetchOsm(building)).wayId}`)}
            >
              {osm ? "Re-fetch" : "Fetch footprint"}
            </button>
            <Link href={`/b/${building}/osm`} className="text-blue-700 hover:underline">
              Open fit →
            </Link>
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <ArrowsClockwise /> 4. Accept, then link shafts
          </h2>
          <p className="mb-3 text-sm text-neutral-600">
            {canonical ? `${canonical.levels.length} levels accepted, ${canonical.shafts.length} shafts.` : "Nothing accepted yet."}
          </p>
          <div className="flex gap-3 text-sm">
            <button
              className="text-blue-700 hover:underline disabled:text-neutral-400"
              disabled={!!busy}
              onClick={() =>
                run("Accept", async () => {
                  const r = await api.accept(building);
                  return r.results.map((x) => `${x.level}: ${x.ok ? "accepted" : x.blockers.join("; ")}`).join("\n");
                })
              }
            >
              Accept all ready levels
            </button>
            <Link href={`/b/${building}/shafts`} className="text-blue-700 hover:underline">
              Shafts & heights →
            </Link>
          </div>
        </div>
      </section>

      {(busy || message) && (
        <pre className="whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-3 text-xs">{busy ? `${busy}…` : message}</pre>
      )}
    </main>
  );
}
