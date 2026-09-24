/**
 * Print sample routes as text, for sanity-checking real building data by eye.
 *
 *   pnpm routes wheeler
 *   pnpm routes wheeler --from wheeler-L1-r120 --to wheeler-L3-r315 --accessible
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Building, type Level, Level as LevelSchema } from "@wf/schema";
import { type RouteGraph, buildGraph } from "./graph";
import { instructions, summary } from "./instructions";
import { nearest } from "./nearest";
import { type Endpoint, type RouteOptions, route } from "./route";

async function load(buildingId: string): Promise<RouteGraph> {
  const root = path.resolve(import.meta.dirname, "../../../data/buildings", buildingId);
  const building = Building.parse(JSON.parse(await readFile(path.join(root, "building.json"), "utf8")));
  const files = (await readdir(path.join(root, "levels"))).filter((f: string) => f.endsWith(".json"));
  const levels: Level[] = await Promise.all(
    files.map(async (f: string) => LevelSchema.parse(JSON.parse(await readFile(path.join(root, "levels", f), "utf8")))),
  );
  return buildGraph(building, levels);
}

function describeRoom(graph: RouteGraph, id: string): string {
  const room = graph.rooms.get(id);
  return room ? `${room.number ?? room.name ?? room.id}` : id;
}

function printRoute(graph: RouteGraph, title: string, from: Endpoint, to: Endpoint, opts: RouteOptions = {}): void {
  const result = route(graph, from, to, opts);
  console.log(`\n=== ${title}${opts.accessible ? "  [accessible]" : ""}`);
  if (!result.ok) {
    console.log(`  ✗ ${result.error}`);
    return;
  }
  console.log(`  ${summary(result.route)}`);
  for (const step of instructions(graph, result.route)) console.log(`  · ${step.text}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const buildingId = args.find((a: string) => !a.startsWith("--")) ?? "wheeler";
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const graph = await load(buildingId);
  const accessible = args.includes("--accessible");

  const from = flag("from");
  const to = flag("to");
  if (from && to) {
    printRoute(graph, `${describeRoom(graph, from)} → ${describeRoom(graph, to)}`, { type: "room", id: from }, { type: "room", id: to }, { accessible });
    return;
  }

  const rooms = [...graph.rooms.values()];
  const byLevel = (levelId: string) => rooms.filter((r) => r.levelId === levelId && r.number && graph.roomDoors.get(r.id)?.length);
  const levelIds = graph.building.levels.map((l) => l.id);
  const pick = (levelId: string, index: number) => byLevel(levelId)[index % Math.max(1, byLevel(levelId).length)];

  console.log(`${graph.building.name}: ${graph.nodes.size} graph nodes, ${rooms.length} rooms, ${graph.building.shafts.length} shafts, ${graph.building.entrances.length} entrances`);

  const a = pick(levelIds[2] ?? levelIds[0]!, 0);
  const b = pick(levelIds[2] ?? levelIds[0]!, 7);
  if (a && b) printRoute(graph, `same floor: ${a.number} → ${b.number}`, { type: "room", id: a.id }, { type: "room", id: b.id });

  const up = pick(levelIds[4] ?? levelIds[levelIds.length - 1]!, 3);
  if (a && up) {
    printRoute(graph, `multi-floor: ${a.number} → ${up.number}`, { type: "room", id: a.id }, { type: "room", id: up.id });
    printRoute(graph, `multi-floor: ${a.number} → ${up.number}`, { type: "room", id: a.id }, { type: "room", id: up.id }, { accessible: true });
  }

  const entrance = graph.building.entrances[0];
  if (entrance && up) printRoute(graph, `${entrance.name} → ${up.number}`, { type: "entrance", id: entrance.id }, { type: "room", id: up.id });

  if (a) {
    for (const kind of ["restroom", "elevator"] as const) {
      const found = nearest(graph, { type: "room", id: a.id }, kind);
      console.log(`\n=== nearest ${kind} from ${a.number}`);
      if (!found.ok) {
        console.log(`  ✗ ${found.error}`);
        continue;
      }
      console.log(`  ${summary(found.route)} → ${found.roomId ? describeRoom(graph, found.roomId) : found.nodeId}`);
      for (const step of instructions(graph, found.route)) console.log(`  · ${step.text}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
