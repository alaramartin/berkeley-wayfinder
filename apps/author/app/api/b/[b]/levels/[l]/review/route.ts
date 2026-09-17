import { readQueue, saveQueue } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ b: string; l: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { b, l } = await params;
  return handle(() => readQueue(b, l));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { b, l } = await params;
  return handle(async () => saveQueue(b, l, await req.json()));
}
