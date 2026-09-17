import { listBuildings } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => (await listBuildings()).map((b) => ({ id: b.id, name: b.name, levels: b.levels.length })));
}
