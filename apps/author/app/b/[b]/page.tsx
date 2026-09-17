import { Overview } from "./Overview";

export default async function Page({ params }: { params: Promise<{ b: string }> }) {
  const { b } = await params;
  return <Overview building={b} />;
}
