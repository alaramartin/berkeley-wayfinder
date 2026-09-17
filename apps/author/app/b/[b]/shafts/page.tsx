import { Shafts } from "./Shafts";

export default async function Page({ params }: { params: Promise<{ b: string }> }) {
  const { b } = await params;
  return <Shafts building={b} />;
}
