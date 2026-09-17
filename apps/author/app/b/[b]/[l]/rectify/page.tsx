import { Rectify } from "./Rectify";

export default async function Page({ params }: { params: Promise<{ b: string; l: string }> }) {
  const { b, l } = await params;
  return <Rectify building={b} level={l} />;
}
