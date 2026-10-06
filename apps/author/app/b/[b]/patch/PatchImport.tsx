"use client";
/**
 * Review a field patch before it touches anything. Every edit is listed with before and after and a
 * checkbox; nothing is written until "Apply". Importing writes the accepted data (what the app reads)
 * and the proposals (so accepting a level again keeps the corrections).
 */
import Link from "next/link";
import { useState } from "react";
import { readPatch } from "@wf/field";
import type { Patch } from "@wf/schema";
import { api, type PatchApplied, type PatchPreview } from "@/lib/client";

export function PatchImport({ building }: { building: string }) {
  const [patch, setPatch] = useState<Patch | null>(null);
  const [preview, setPreview] = useState<PatchPreview | null>(null);
  const [accept, setAccept] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<PatchApplied | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(text: string) {
    setError(null);
    setApplied(null);
    setPreview(null);
    const read = readPatch(text);
    if (!read.ok) return setError(read.error);
    setPatch(read.patch);
    try {
      const p = await api.patch(building, { action: "preview", patch: read.patch });
      setPreview(p);
      setAccept(new Set(p.results.filter((r) => r.status === "applied").map((r) => r.index)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function apply() {
    if (!patch) return;
    setBusy(true);
    try {
      const r = await api.patch(building, { action: "apply", patch, accept: [...accept] });
      setApplied(r as PatchApplied);
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (i: number) =>
    setAccept((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <div className="flex items-baseline gap-3">
        <Link href={`/b/${building}`} className="text-blue-700 hover:underline">
          ← {building}
        </Link>
        <h1 className="text-xl font-semibold">Import a field patch</h1>
      </div>
      <p className="text-sm text-neutral-600">
        Choose the file you sent from the field tool. You will see every edit before anything changes. Close the other author pages first: an open level saves itself and would write over an import.
      </p>

      <input
        type="file"
        accept="application/json,.json"
        className="block text-sm"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) await load(await file.text());
        }}
      />

      {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {applied && (
        <section className="space-y-2 rounded border border-green-300 bg-green-50 p-4 text-sm">
          <p className="font-medium">
            Imported {applied.applied} edit{applied.applied === 1 ? "" : "s"}.
          </p>
          <ul className="list-disc pl-5 text-neutral-700">
            {applied.written.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p>To see it in the app: rebuild the app (or commit and push, which deploys it).</p>
        </section>
      )}

      {preview && patch && (
        <section className="space-y-4">
          <p className="text-sm text-neutral-600">
            {patch.ops.length} edit{patch.ops.length === 1 ? "" : "s"} from {patch.author ?? "someone"}, made {new Date(patch.createdAt).toLocaleString()}.
          </p>
          {!preview.baseMatches && (
            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              The data has changed since this patch was made (a room number, door, corridor access, entrance or step count differs). Edits that still fit are listed below; check them before applying.
            </p>
          )}

          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white text-sm">
            {preview.results.map((r) => (
              <li key={r.index} className="flex items-start gap-3 p-3">
                <input type="checkbox" className="mt-1" disabled={r.status === "skipped"} checked={accept.has(r.index)} onChange={() => toggle(r.index)} />
                <div className="min-w-0">
                  <p className="font-medium">{r.summary}</p>
                  {r.status === "applied" && r.op.op !== "note" && (
                    <p className="text-neutral-500">
                      {r.before} → {r.after}
                    </p>
                  )}
                  {r.status === "skipped" && <p className="text-red-700">Cannot apply: {r.reason}</p>}
                </div>
              </li>
            ))}
          </ul>

          {preview.elevations.length > 0 && (
            <div className="rounded border border-neutral-200 bg-white p-3 text-sm">
              <p className="mb-2 font-medium">Floor heights from the step counts</p>
              <table className="w-full text-left">
                <thead className="text-neutral-500">
                  <tr>
                    <th>Level</th>
                    <th>Elevation</th>
                    <th>Height to next</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.elevations.map((e) => (
                    <tr key={e.levelId}>
                      <td>{e.levelId}</td>
                      <td>
                        {e.before.elevationM} → {e.after.elevationM} m
                      </td>
                      <td>
                        {e.before.heightM} → {e.after.heightM} m ({e.after.heightSource})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.elevationNotes.map((n) => (
                <p key={n} className="mt-2 text-amber-800">
                  {n}
                </p>
              ))}
            </div>
          )}

          <button className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={busy || accept.size === 0} onClick={apply}>
            {busy ? "Applying…" : `Apply ${accept.size} edit${accept.size === 1 ? "" : "s"}`}
          </button>
        </section>
      )}
    </main>
  );
}
