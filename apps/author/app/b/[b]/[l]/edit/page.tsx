import { Editor } from "./Editor";

export default async function Page({ params }: { params: Promise<{ b: string; l: string }> }) {
  const { b, l } = await params;
  return <Editor building={b} level={l} />;
}
