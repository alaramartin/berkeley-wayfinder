import { BadRequest } from "@/lib/server/data";
import { PIPELINE_URL, handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request, { params }: { params: Promise<{ b: string; l: string }> }) {
  const { b, l } = await params;
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { fromStage?: string; toStage?: string };
    let res: Response;
    try {
      res = await fetch(`${PIPELINE_URL}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ building: b, level: l, fromStage: body.fromStage ?? null, toStage: body.toStage ?? null }),
      });
    } catch {
      throw new BadRequest("pipeline service not running: start it with `cd pipeline && uv run wf serve`");
    }
    return res.json();
  });
}
