/**
 * Re-attach stairs and lifts to the nearest corridor, for every level of a building.
 *
 *   pnpm exec tsx scripts/relink-vertical.mts [building]            # dry run: report only
 *   pnpm exec tsx scripts/relink-vertical.mts [building] --apply    # save proposals, then re-accept them
 *
 * Close the author tool first. It autosaves the proposal it has open, and would write its stale copy
 * back over this one.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { relinkVertical } from "../lib/relink";
import { acceptLevels } from "../lib/server/acceptBuilding";
import { REPO_ROOT, loadConfig, readProposal, saveProposal } from "../lib/server/data";

const building = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? "wheeler";
const apply = process.argv.includes("--apply");

const config = await loadConfig(building);
const changed: string[] = [];

for (const level of config.levels) {
  const proposal = await readProposal(building, level.id).catch(() => null);
  if (!proposal) continue;
  // Pixels per metre from the accepted level, which is where the transform lives.
  const canonical = JSON.parse(await readFile(path.join(REPO_ROOT, "data", "buildings", building, "levels", `${level.id}.json`), "utf8")) as {
    imageTransform: { scale: number };
  };
  const pxPerM = 1 / canonical.imageTransform.scale;
  const { proposal: fixed, changes } = relinkVertical(proposal, { pxPerM });
  if (!changes.length) continue;
  for (const c of changes) {
    console.log(`${level.id}  ${c.kind} ${c.nodeId}: link ${c.linkBeforeM.toFixed(1)} m -> ${c.linkAfterM.toFixed(1)} m, now attached to ${c.toEdge} (was ${c.fromEdge})`);
  }
  if (apply) {
    // Optimistic check: refuse if the proposal changed since we read it (the author tool is open).
    const again = await readProposal(building, level.id);
    if (again.editedAt !== proposal.editedAt) throw new Error(`${level.id} changed while this ran; close the author tool and try again`);
    await saveProposal(building, level.id, fixed);
    changed.push(level.id);
  }
}

if (!changed.length) {
  console.log(apply ? "nothing to change" : "\n(dry run: nothing written. Add --apply to save and re-accept.)");
} else {
  const result = await acceptLevels(building, changed);
  for (const r of result.results) console.log(`accept ${r.level}: ${r.ok ? "ok" : `BLOCKED ${r.blockers.join("; ")}`}`);
  if (result.results.some((r) => !r.ok)) process.exitCode = 1;
}
