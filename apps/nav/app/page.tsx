import { Buildings, NavigationArrow } from "@phosphor-icons/react/dist/ssr";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <header className="flex items-center gap-2 text-berkeley-blue">
        <NavigationArrow size={28} weight="fill" />
        <h1 className="text-2xl font-semibold">Berkeley Wayfinder</h1>
      </header>
      <p className="text-neutral-600">Indoor directions for UC Berkeley buildings. Coming soon.</p>
      <div className="flex items-center gap-3 rounded-xl border border-neutral-200 p-4">
        <Buildings size={24} className="text-california-gold" />
        <span className="font-medium">Wheeler Hall</span>
        <span className="ml-auto text-sm text-neutral-500">in progress</span>
      </div>
    </main>
  );
}
