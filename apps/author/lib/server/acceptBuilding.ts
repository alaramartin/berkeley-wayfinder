/** Server-side accept: proposals + alignment + OSM -> canonical building.json and levels/*.json. */
import { levelImageTransform, toLocal } from "@wf/geometry";
import type { Building, Entrance, Level } from "@wf/schema";
import { acceptBlockers, proposalToLevel } from "../accept";
import { BadRequest, loadConfig, readAlignment, readBuilding, readLevel, readOsm, readProposal, readQueue, saveBuilding, saveLevel } from "./data";

export interface AcceptResult {
  level: string;
  ok: boolean;
  blockers: string[];
}

export async function acceptLevels(b: string, requested?: string[]): Promise<{ results: AcceptResult[]; building: Building | null }> {
  const cfg = await loadConfig(b);
  const alignment = await readAlignment(b);
  const osm = await readOsm(b);
  if (!alignment.osm.transform || !alignment.osm.origin) throw new BadRequest("fit the reference level to the OSM footprint first");

  const levelIds = requested?.length ? requested : cfg.levels.map((l) => l.id);
  const proposals = new Map<string, Awaited<ReturnType<typeof readProposal>>>();
  for (const lv of cfg.levels) {
    try {
      proposals.set(lv.id, await readProposal(b, lv.id));
    } catch {
      /* level without proposal */
    }
  }
  // Directory aliases apply across levels (Wheeler's L1 placard lists rooms on every floor).
  const aliases = new Map<string, string[]>();
  for (const p of proposals.values()) {
    for (const d of p.directory ?? []) if (d.confidence >= 0.9) aliases.set(d.room, [...new Set([...(aliases.get(d.room) ?? []), d.name])]);
  }

  const results: AcceptResult[] = [];
  for (const id of levelIds) {
    const lvCfg = cfg.levels.find((l) => l.id === id);
    const proposal = proposals.get(id);
    const toRef = alignment.levels[id]?.transform;
    const blockers: string[] = [];
    if (!lvCfg) blockers.push("unknown level");
    if (!proposal) blockers.push("no proposal");
    if (!toRef) blockers.push("level not aligned to the reference level");
    if (proposal) blockers.push(...acceptBlockers(proposal, (await readQueue(b, id)).items));
    if (blockers.length || !proposal || !lvCfg || !toRef) {
      results.push({ level: id, ok: false, blockers });
      continue;
    }
    const existing = await readLevel(b, id);
    const withAliases = { ...proposal, rooms: proposal.rooms.map((r) => ({ ...r, aliases: [...new Set([...(r.aliases ?? []), ...(r.number ? aliases.get(r.number) ?? [] : [])])] })) };
    const level: Level = proposalToLevel(
      withAliases,
      {
        sortIndex: lvCfg.sortIndex,
        displayName: lvCfg.displayName,
        elevationM: existing?.elevationM ?? lvCfg.elevationM ?? lvCfg.sortIndex * cfg.defaultFloorHeightM,
        heightM: existing?.heightM ?? cfg.defaultFloorHeightM,
        heightSource: existing?.heightSource ?? "default",
        verified: lvCfg.verified,
      },
      levelImageTransform(toRef, alignment.osm.transform),
    );
    await saveLevel(b, level);
    results.push({ level: id, ok: true, blockers: [] });
  }

  const accepted: Level[] = [];
  for (const lv of cfg.levels) {
    const level = await readLevel(b, lv.id);
    if (level) accepted.push(level);
  }
  const nodeIds = new Set(accepted.flatMap((l) => l.nodes.map((n) => n.id)));
  const previous = await readBuilding(b);
  const entrances: Entrance[] = [];
  for (const [levelId, p] of proposals) {
    if (!accepted.some((l) => l.id === levelId)) continue;
    (p.entrances ?? []).forEach((e, i) => {
      if (nodeIds.has(e.nodeId)) entrances.push({ id: e.id, nodeId: e.nodeId, name: e.name ?? `Level ${levelId} entrance ${i + 1}`, accessible: e.accessible, verified: false });
    });
  }
  const origin = alignment.osm.origin;
  const building = accepted.length
    ? await saveBuilding(b, {
        id: cfg.id,
        name: cfg.name,
        aliases: cfg.aliases,
        osmWayId: osm?.wayId ?? cfg.osmWayId ?? null,
        origin,
        footprint: osm ? osm.ring.map((pt) => toLocal(origin, pt)) : [],
        levels: accepted.map((l) => ({ id: l.id, sortIndex: l.sortIndex })),
        // Keep confirmed shafts whose nodes still exist.
        shafts: (previous?.shafts ?? []).filter((s) => s.nodeIds.every((n) => nodeIds.has(n))),
        edges: (previous?.edges ?? []).filter((e) => nodeIds.has(e.a) && nodeIds.has(e.b)),
        entrances,
      })
    : previous;
  return { results, building };
}
