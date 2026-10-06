/** Reading the data a patch is checked against, and writing what an import changed. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { Patch, type Proposal } from "@wf/schema";
import { type PatchInput, type PatchOutcome, runPatch } from "../patch";
import { BadRequest, NotFound, loadConfig, paths, readBuilding, readLevel, readProposal, saveBuilding, saveLevel, saveProposal } from "./data";

async function loadInput(b: string): Promise<PatchInput> {
  const building = await readBuilding(b);
  if (!building) throw new NotFound(`no accepted data for ${b} yet`);
  const levels = [];
  for (const ref of building.levels) {
    const level = await readLevel(b, ref.id);
    if (level) levels.push(level);
  }
  const proposals = new Map<string, Proposal>();
  for (const lv of (await loadConfig(b)).levels) {
    const p = await readProposal(b, lv.id).catch(() => null);
    if (p) proposals.set(lv.id, p);
  }
  return { building, levels, proposals };
}

function parse(patch: unknown, b: string) {
  const parsed = Patch.safeParse(patch);
  if (!parsed.success) throw new BadRequest(`not a field patch: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`);
  if (parsed.data.buildingId !== b) throw new BadRequest(`this patch is for ${parsed.data.buildingId}, not ${b}`);
  return parsed.data;
}

/** What importing would do. Writes nothing. */
export async function previewPatch(b: string, patch: unknown): Promise<Omit<PatchOutcome, "building" | "levels" | "proposals">> {
  const outcome = runPatch(await loadInput(b), parse(patch, b));
  const { building: _b, levels: _l, proposals: _p, ...summary } = outcome;
  return summary;
}

/** Apply the accepted ops and write the files they changed. */
export async function applyPatch(b: string, patch: unknown, accepted: number[]) {
  const input = await loadInput(b);
  const parsed = parse(patch, b);
  const outcome = runPatch(input, parsed, new Set(accepted));

  const written: string[] = [];
  for (const level of outcome.levels) {
    if (!outcome.changedLevels.includes(level.id)) continue;
    await saveLevel(b, level);
    written.push(`data/buildings/${b}/levels/${level.id}.json`);
  }
  if (outcome.buildingChanged) {
    await saveBuilding(b, outcome.building);
    written.push(`data/buildings/${b}/building.json`);
  }
  for (const id of outcome.changedProposals) {
    await saveProposal(b, id, outcome.proposals.get(id)!);
    written.push(`data/work/${b}/${id}/proposal.json`);
  }
  if (outcome.notes.length) {
    const file = path.join(paths.buildingWork(b), "field-notes.json");
    const existing = await fs.readFile(file, "utf8").then((t) => JSON.parse(t) as unknown[], () => []);
    const stamp = new Date().toISOString();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify([...existing, ...outcome.notes.map((n) => ({ ...n, author: parsed.author ?? null, patchCreatedAt: parsed.createdAt, importedAt: stamp }))], null, 2) + "\n");
    written.push(`data/work/${b}/field-notes.json`);
  }
  return {
    applied: outcome.results.filter((r) => r.status === "applied").length,
    skipped: outcome.results.filter((r) => r.status === "skipped").length,
    elevations: outcome.elevations,
    elevationNotes: outcome.elevationNotes,
    written,
  };
}
