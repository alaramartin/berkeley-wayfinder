/**
 * Remove rooms or detected icons from a level's proposal, then re-accept the level.
 *
 *   pnpm exec tsx scripts/remove-items.mts wheeler L2 room:wheeler-L2-rDWA icon:wheeler-L2-i000           # dry run
 *   pnpm exec tsx scripts/remove-items.mts wheeler L2 room:wheeler-L2-rDWA icon:wheeler-L2-i000 --apply
 *
 * Close the author tool first. It autosaves the proposal it has open, and would write its stale copy
 * back over this one.
 */
import { acceptLevels } from "../lib/server/acceptBuilding";
import { readProposal, saveProposal } from "../lib/server/data";

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const [building, level, ...items] = args;
if (!building || !level || !items.length) throw new Error("usage: remove-items.mts <building> <level> <room:id|icon:id>... [--apply]");
const apply = process.argv.includes("--apply");

const proposal = await readProposal(building, level);
for (const item of items) {
  const [kind, id] = item.split(":");
  if (kind === "room") {
    const before = proposal.rooms.length;
    proposal.rooms = proposal.rooms.filter((r) => r.id !== id);
    if (proposal.rooms.length === before) throw new Error(`no room ${id} on ${level}`);
  } else if (kind === "icon") {
    const before = proposal.icons.length;
    proposal.icons = proposal.icons.filter((i) => i.id !== id);
    if (proposal.icons.length === before) throw new Error(`no icon ${id} on ${level}`);
  } else throw new Error(`unknown item ${item}`);
  console.log(`${level}: removed ${kind} ${id}`);
}
if (!apply) {
  console.log("\n(dry run: nothing written. Add --apply to save and re-accept.)");
} else {
  const again = await readProposal(building, level);
  if (again.editedAt !== proposal.editedAt) throw new Error(`${level} changed while this ran; close the author tool and try again`);
  await saveProposal(building, level, proposal);
  const result = await acceptLevels(building, [level]);
  for (const r of result.results) console.log(`accept ${r.level}: ${r.ok ? "ok" : `BLOCKED ${r.blockers.join("; ")}`}`);
  if (result.results.some((r) => !r.ok)) process.exitCode = 1;
}
