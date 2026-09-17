import Link from "next/link";
import { Buildings } from "@phosphor-icons/react/dist/ssr";
import { listBuildings } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const buildings = await listBuildings();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Buildings</h1>
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        {buildings.map((b) => (
          <li key={b.id}>
            <Link href={`/b/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50">
              <Buildings size={20} />
              <span className="font-medium">{b.name}</span>
              <span className="ml-auto text-sm text-neutral-500">{b.levels.length} levels</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
