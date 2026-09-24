import { Buildings, NavigationArrow } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function buildings(): Promise<{ id: string; name: string; levels: number }[]> {
  const dir = path.join(process.cwd(), "public", "data");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const json = JSON.parse(await readFile(path.join(dir, entry.name, "building.json"), "utf8")) as { name: string; levels: unknown[] };
    out.push({ id: entry.name, name: json.name, levels: json.levels.length });
  }
  return out;
}

export default async function Home() {
  const list = await buildings();
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <header className="flex items-center gap-2 text-berkeley-blue">
        <NavigationArrow size={28} weight="fill" />
        <h1 className="text-2xl font-semibold">Berkeley Wayfinder</h1>
      </header>
      <p className="text-neutral-600">Indoor directions for UC Berkeley buildings.</p>
      <ul className="space-y-2">
        {list.map((b) => (
          <li key={b.id}>
            <Link href={`/${b.id}`} className="flex items-center gap-3 rounded-xl border border-neutral-200 p-4 hover:border-berkeley-blue">
              <Buildings size={24} className="text-california-gold" />
              <span className="font-medium">{b.name}</span>
              <span className="ml-auto text-sm text-neutral-500">{b.levels} levels</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500">
        Floor plans are traced from the directory placards posted in each building. Distances are approximate, and some doors are still unverified.
      </p>
    </main>
  );
}
