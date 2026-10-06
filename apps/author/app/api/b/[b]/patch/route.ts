import { applyPatch, previewPatch } from "@/lib/server/patch";
import { handle } from "@/lib/server/http";
import { BadRequest, safe } from "@/lib/server/data";

export const dynamic = "force-dynamic";

/** POST { action: "preview", patch } -> what it would change. POST { action: "apply", patch, accept: number[] } -> write it. */
export function POST(req: Request, ctx: { params: Promise<{ b: string }> }) {
  return handle(async () => {
    const { b } = await ctx.params;
    const body = (await req.json()) as { action?: string; patch?: unknown; accept?: unknown };
    safe(b);
    if (body.action === "preview") return previewPatch(b, body.patch);
    if (body.action === "apply") {
      if (!Array.isArray(body.accept) || !body.accept.every((n) => Number.isInteger(n))) throw new BadRequest("accept must be a list of op numbers");
      return applyPatch(b, body.patch, body.accept as number[]);
    }
    throw new BadRequest("action must be preview or apply");
  });
}
