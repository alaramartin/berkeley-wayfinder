import { PatchImport } from "./PatchImport";

export default async function Page({ params }: { params: Promise<{ b: string }> }) {
  const { b } = await params;
  return <PatchImport building={b} />;
}
