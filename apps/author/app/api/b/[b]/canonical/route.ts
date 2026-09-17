import { loadConfig, readBuilding, readLevel, saveBuilding, saveLevel } from "@/lib/server/data";
import { handle } from "@/lib/server/http";
import { Level } from "@wf/schema";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ b: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { b } = await params;
  return handle(async () => {
    const cfg = await loadConfig(b);
    const levels = [];
    for (const lv of cfg.levels) {
      const level = await readLevel(b, lv.id);
      if (level) levels.push(level);
    }
    return { building: await readBuilding(b), levels };
  });
}

/** Save shafts/vertical edges on building.json and elevations on level files. */
export async function PUT(req: Request, { params }: Ctx) {
  const { b } = await params;
  return handle(async () => {
    const body = (await req.json()) as { building: unknown; levels?: unknown[] };
    const building = await saveBuilding(b, body.building);
    for (const raw of body.levels ?? []) await saveLevel(b, Level.parse(raw));
    return { building };
  });
}
