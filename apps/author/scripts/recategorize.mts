/**
 * Change the category of named rooms on one level, then re-accept the level.
 *
 *   pnpm exec tsx scripts/recategorize.mts wheeler L2 220=classroom 222=classroom           # dry run
 *   pnpm exec tsx scripts/recategorize.mts wheeler L2 220=classroom --group "General Assignment Classrooms" --apply
 *
 * For fixing a colour the classifier misread. Close the author tool first: it autosaves the proposal it
 * has open and would write its stale copy back over this one.
 */
import { acceptLevels } from "../lib/server/acceptBuilding";
import { readProposal, saveProposal } from "../lib/server/data";

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const groupAt = args.indexOf("--group");
const group = groupAt >= 0 ? args.splice(groupAt, 2)[1] : undefined;
const [building, level, ...changes] = args;
if (!building || !level || !changes.length) throw new Error("usage: recategorize.mts <building> <level> <number>=<category>... [--group <name>] [--apply]");
const apply = process.argv.includes("--apply");

const proposal = await readProposal(building, level);
for (const change of changes) {
  const [number, category] = change.split("=");
  const rooms = proposal.rooms.filter((r) => r.number === number);
  if (!rooms.length) throw new Error(`no room ${number} on ${level}`);
  for (const room of rooms) {
    console.log(`${room.id}: ${room.category} -> ${category}${group ? ` (${group})` : ""}`);
    room.category = category as typeof room.category;
    if (group) room.group = group;
  }
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
