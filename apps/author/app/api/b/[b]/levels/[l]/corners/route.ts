import { ingestSize, saveCorners } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ b: string; l: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { b, l } = await params;
  return handle(() => ingestSize(b, l));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { b, l } = await params;
  return handle(async () => {
    const { corners } = (await req.json()) as { corners: [number, number][] };
    await saveCorners(b, l, corners);
    return { ok: true };
  });
}
