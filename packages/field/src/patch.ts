import { Patch, type PatchOp } from "@wf/schema";
import type { FieldData } from "./apply";
import { hashFieldData } from "./hash";

/** Wrap recorded ops as a patch against the data they were made on. */
export function makePatch(buildingId: string, base: FieldData, ops: PatchOp[], author?: string, now: Date = new Date()): Patch {
  return { buildingId, baseHash: hashFieldData(base), createdAt: now.toISOString(), ...(author ? { author } : {}), ops };
}

/** Parse a patch file's text, with a message a person can act on. */
export function readPatch(text: string): { ok: true; patch: Patch } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not JSON." };
  }
  const parsed = Patch.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Not a field patch: ${first ? `${first.path.join(".") || "file"} ${first.message}` : "invalid"}.` };
  }
  return { ok: true, patch: parsed.data };
}
