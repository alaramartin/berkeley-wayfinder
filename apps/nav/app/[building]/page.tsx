import { notFound } from "next/navigation";
import { Suspense } from "react";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { BuildingView } from "./BuildingView";

export async function generateStaticParams() {
  const dir = path.join(process.cwd(), "public", "data");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => ({ building: e.name }));
}

// Typed by hand rather than with the generated `PageProps` helper: that global only exists once
// `next typegen` has written `.next/types`, so typecheck failed on any clean checkout, including CI.
export default async function BuildingPage(props: { params: Promise<{ building: string }> }) {
  const { building } = await props.params;
  if (!/^[a-z0-9-]+$/.test(building)) notFound();
  return (
    // useSearchParams needs a boundary: the shell prerenders, the URL-driven view hydrates.
    <Suspense fallback={<main className="p-6 text-neutral-500">Loading…</main>}>
      <BuildingView buildingId={building} />
    </Suspense>
  );
}
