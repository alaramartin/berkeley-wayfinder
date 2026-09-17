import { levelSummaries, loadConfig, readAlignment, readBuilding, readOsm } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ b: string }> }) {
  const { b } = await params;
  return handle(async () => ({
    config: await loadConfig(b),
    levels: await levelSummaries(b),
    alignment: await readAlignment(b),
    osm: await readOsm(b),
    building: await readBuilding(b),
  }));
}
