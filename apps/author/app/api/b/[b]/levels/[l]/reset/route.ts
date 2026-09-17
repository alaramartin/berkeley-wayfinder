import { resetFromAuto } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ b: string; l: string }> }) {
  const { b, l } = await params;
  return handle(() => resetFromAuto(b, l));
}
