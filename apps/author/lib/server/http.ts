import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BadRequest, NotFound } from "./data";

/** Wrap a route handler: typed errors become 400/404 JSON instead of 500s. */
export async function handle(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    const result = await fn();
    return result instanceof NextResponse ? result : NextResponse.json(result ?? { ok: true });
  } catch (e) {
    if (e instanceof NotFound) return NextResponse.json({ error: `not found: ${e.message}` }, { status: 404 });
    if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof ZodError) return NextResponse.json({ error: "validation failed", issues: e.issues.slice(0, 10) }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const PIPELINE_URL = process.env.WF_PIPELINE_URL ?? "http://127.0.0.1:8765";
