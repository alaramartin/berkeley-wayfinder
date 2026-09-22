import { BadRequest } from "@/lib/server/data";
import { PIPELINE_URL, handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Cuts one merged suite along the walls printed on the placard; the pipeline service does the pixel work. */
export async function POST(req: Request, { params }: { params: Promise<{ b: string; l: string }> }) {
  const { b, l } = await params;
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { polygon?: number[][]; seeds?: number[][] };
    if (!body.polygon?.length || !body.seeds?.length) throw new BadRequest("polygon and seeds are required");
    let res: Response;
    try {
      res = await fetch(`${PIPELINE_URL}/suite-split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ building: b, level: l, polygon: body.polygon, seeds: body.seeds }),
      });
    } catch {
      throw new BadRequest("pipeline service not running: start it with `cd pipeline && uv run wf serve`");
    }
    if (!res.ok) throw new BadRequest(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? "suite split failed");
    return res.json();
  });
}
