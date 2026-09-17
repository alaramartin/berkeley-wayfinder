import { NextResponse } from "next/server";
import { workFile } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ b: string; l: string; path: string[] }> }) {
  const { b, l, path } = await params;
  return handle(async () => {
    const { data, type } = await workFile(b, l, path);
    return new NextResponse(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "no-cache" } });
  });
}
