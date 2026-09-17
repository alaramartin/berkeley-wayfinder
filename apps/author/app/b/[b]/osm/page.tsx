import { OsmFitPage } from "./OsmFit";

export default async function Page({ params }: { params: Promise<{ b: string }> }) {
  const { b } = await params;
  return <OsmFitPage building={b} />;
}
