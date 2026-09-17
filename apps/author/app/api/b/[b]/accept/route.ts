import { acceptLevels } from "@/lib/server/acceptBuilding";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ b: string }> }) {
  const { b } = await params;
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { levels?: string[] };
    return acceptLevels(b, body.levels);
  });
}
