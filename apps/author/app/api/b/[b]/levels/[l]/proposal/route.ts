import { readAutoProposal, readProposal, saveProposal } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ b: string; l: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { b, l } = await params;
  const auto = new URL(req.url).searchParams.get("auto") === "1";
  return handle(() => (auto ? readAutoProposal(b, l) : readProposal(b, l)));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { b, l } = await params;
  return handle(async () => saveProposal(b, l, await req.json()));
}
