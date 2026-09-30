/**
 * Dry run: what would straightening do to each Wheeler level? Reads proposals, reports, writes nothing.
 *
 *   pnpm exec tsx scripts/straighten-report.mts [building]
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Proposal } from "@wf/schema";
import { dominantAxis, straightenEdges } from "../lib/straighten";

const root = path.resolve(import.meta.dirname, "../../..");
const building = process.argv[2] ?? "wheeler";
const work = path.join(root, "data", "work", building);
const canonical = path.join(root, "data", "buildings", building, "levels");

const levels = (await readdir(work, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);

console.log(`${building}: straightening dry run\n`);
console.log("level  axis   corridor before -> after   max move   doors >0.5m   side flips   edges (changed/skipped/vetoed)");

for (const id of levels.sort()) {
  let proposal: Proposal;
  try {
    proposal = Proposal.parse(JSON.parse(await readFile(path.join(work, id, "proposal.json"), "utf8")));
  } catch {
    continue;
  }
  // Pixels per metre comes from the accepted level's transform.
  let pxPerM = 25;
  try {
    const level = JSON.parse(await readFile(path.join(canonical, `${id}.json`), "utf8")) as { imageTransform: { scale: number } };
    pxPerM = 1 / level.imageTransform.scale;
  } catch {
    /* not accepted yet; the default is close enough for a dry run */
  }

  const axis = dominantAxis(proposal);
  const { report } = straightenEdges(proposal, axis, { pxPerM });
  const t = report.totals;
  console.log(
    `${id.padEnd(6)} ${report.axisDeg.toFixed(1).padStart(5)}  ${t.corridorBeforeM.toFixed(1).padStart(7)} -> ${t.corridorAfterM
      .toFixed(1)
      .padStart(6)} m  ${t.maxMoveM.toFixed(2).padStart(6)} m   ${String(t.doorsFlagged).padStart(9)}   ${String(t.sideFlips).padStart(10)}   ${t.edgesChanged}/${t.edgesSkipped}/${t.edgesVetoed}`,
  );
  for (const door of report.doors.slice(0, 6)) {
    const flip = door.sideBefore !== door.sideAfter ? ` side ${door.sideBefore} -> ${door.sideAfter}` : "";
    console.log(`         room ${door.roomNumber ?? door.roomId} on ${door.edgeId}: moved ${door.movedM.toFixed(2)} m${flip}`);
  }
  const vetoed = report.edges.filter((e) => e.vetoed);
  for (const edge of vetoed.slice(0, 4)) console.log(`         left alone: ${edge.edgeId} (${edge.vetoed})`);
}
