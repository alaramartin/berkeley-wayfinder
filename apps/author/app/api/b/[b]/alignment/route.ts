import { readAlignment, saveAlignment } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ b: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { b } = await params;
  return handle(() => readAlignment(b));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { b } = await params;
  return handle(async () => saveAlignment(b, await req.json()));
}
