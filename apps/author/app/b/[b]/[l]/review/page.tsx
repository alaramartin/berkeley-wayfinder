import { Review } from "./Review";

export default async function Page({ params }: { params: Promise<{ b: string; l: string }> }) {
  const { b, l } = await params;
  return <Review building={b} level={l} />;
}
