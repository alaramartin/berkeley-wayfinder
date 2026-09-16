import { PencilRuler } from "@phosphor-icons/react/dist/ssr";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
      <header className="flex items-center gap-2">
        <PencilRuler size={28} />
        <h1 className="text-2xl font-semibold">Wayfinder Author</h1>
      </header>
      <p className="text-neutral-600">
        Local-only desk tool for reviewing pipeline proposals and accepting canonical building data. Built in M2.
      </p>
    </main>
  );
}
