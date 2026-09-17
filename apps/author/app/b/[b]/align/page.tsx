import { Align } from "./Align";

export default async function Page({ params }: { params: Promise<{ b: string }> }) {
  const { b } = await params;
  return <Align building={b} />;
}
