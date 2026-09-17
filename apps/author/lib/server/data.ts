/** Filesystem access to data/ for the local author tool. Never bundled into the deployed nav app. */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Alignment,
  Building,
  BuildingConfig,
  Level,
  Proposal,
  ReviewQueue,
  type ReviewItem,
} from "@wf/schema";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { acceptBlockers } from "../accept";
import { components } from "../graph";

export const REPO_ROOT = process.env.WF_REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
const DATA = path.join(REPO_ROOT, "data");

export class NotFound extends Error {}
export class BadRequest extends Error {}

export function safe(segment: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new BadRequest(`bad path segment: ${segment}`);
  return segment;
}

export const paths = {
  raw: (b: string) => path.join(DATA, "raw", safe(b)),
  work: (b: string, l: string) => path.join(DATA, "work", safe(b), safe(l)),
  buildingWork: (b: string) => path.join(DATA, "work", safe(b)),
  canonical: (b: string) => path.join(DATA, "buildings", safe(b)),
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<S extends z.ZodTypeAny>(file: string, schema: S): Promise<z.infer<S>> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    throw new NotFound(path.relative(REPO_ROOT, file));
  }
  return schema.parse(JSON.parse(text));
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await fs.rename(tmp, file);
}

export async function listBuildings(): Promise<BuildingConfig[]> {
  const dirs = await fs.readdir(path.join(DATA, "raw"), { withFileTypes: true });
  const out: BuildingConfig[] = [];
  for (const d of dirs) {
    if (d.isDirectory() && (await exists(path.join(DATA, "raw", d.name, "config.yaml")))) out.push(await loadConfig(d.name));
  }
  return out;
}

export async function loadConfig(b: string): Promise<BuildingConfig> {
  const file = path.join(paths.raw(b), "config.yaml");
  if (!(await exists(file))) throw new NotFound(`no config for ${b}`);
  return BuildingConfig.parse(parseYaml(await fs.readFile(file, "utf8")));
}

export const readProposal = (b: string, l: string) => readJson(path.join(paths.work(b, l), "proposal.json"), Proposal);
export const readAutoProposal = (b: string, l: string) => readJson(path.join(paths.work(b, l), "proposal.auto.json"), Proposal);

export async function saveProposal(b: string, l: string, p: unknown): Promise<Proposal> {
  const parsed = Proposal.parse(p);
  if (parsed.buildingId !== b || parsed.levelId !== l) throw new BadRequest("proposal building/level mismatch");
  const saved = { ...parsed, editedAt: new Date().toISOString() };
  await writeJson(path.join(paths.work(b, l), "proposal.json"), saved);
  return saved;
}

export async function readQueue(b: string, l: string): Promise<ReviewQueue> {
  try {
    return await readJson(path.join(paths.work(b, l), "review-queue.json"), ReviewQueue);
  } catch (e) {
    if (e instanceof NotFound) return { buildingId: b, levelId: l, items: [] };
    throw e;
  }
}

export async function saveQueue(b: string, l: string, q: unknown): Promise<ReviewQueue> {
  const parsed = ReviewQueue.parse(q);
  await writeJson(path.join(paths.work(b, l), "review-queue.json"), parsed);
  return parsed;
}

/** Replace the hand-edited proposal with the latest pipeline output (keeps a backup). */
export async function resetFromAuto(b: string, l: string): Promise<Proposal> {
  const dir = paths.work(b, l);
  const auto = await readAutoProposal(b, l);
  await fs.copyFile(path.join(dir, "proposal.json"), path.join(dir, `proposal.backup-${Date.now()}.json`));
  await writeJson(path.join(dir, "proposal.json"), auto);
  if (await exists(path.join(dir, "review-queue.auto.json"))) await fs.copyFile(path.join(dir, "review-queue.auto.json"), path.join(dir, "review-queue.json"));
  return auto;
}

export async function readAlignment(b: string): Promise<Alignment> {
  const file = path.join(paths.buildingWork(b), "alignment.json");
  if (await exists(file)) return readJson(file, Alignment);
  const cfg = await loadConfig(b);
  const reference = cfg.referenceLevel ?? cfg.levels[0]!.id;
  return Alignment.parse({
    buildingId: b,
    referenceLevel: reference,
    levels: Object.fromEntries(
      cfg.levels.map((lv) => [lv.id, lv.id === reference ? { transform: { scale: 1, rotation: 0, tx: 0, ty: 0 }, rms: 0 } : { transform: null, rms: null }]),
    ),
    osm: { wayId: null, origin: null, transform: null, rms: null },
  });
}

export async function saveAlignment(b: string, a: unknown): Promise<Alignment> {
  const parsed = Alignment.parse(a);
  await writeJson(path.join(paths.buildingWork(b), "alignment.json"), parsed);
  return parsed;
}

export interface OsmFootprint {
  wayId: number;
  name: string | null;
  fetchedAt: string;
  /** Closed ring, lat/lon. */
  ring: { lat: number; lon: number }[];
}

export async function readOsm(b: string): Promise<OsmFootprint | null> {
  const file = path.join(paths.canonical(b), "osm.json");
  if (!(await exists(file))) return null;
  return JSON.parse(await fs.readFile(file, "utf8")) as OsmFootprint;
}

export async function saveOsm(b: string, osm: OsmFootprint): Promise<void> {
  await writeJson(path.join(paths.canonical(b), "osm.json"), osm);
}

export async function readBuilding(b: string): Promise<Building | null> {
  const file = path.join(paths.canonical(b), "building.json");
  return (await exists(file)) ? readJson(file, Building) : null;
}

export async function saveBuilding(b: string, building: unknown): Promise<Building> {
  const parsed = Building.parse(building);
  await writeJson(path.join(paths.canonical(b), "building.json"), parsed);
  return parsed;
}

export async function readLevel(b: string, l: string): Promise<Level | null> {
  const file = path.join(paths.canonical(b), "levels", `${safe(l)}.json`);
  return (await exists(file)) ? readJson(file, Level) : null;
}

export async function saveLevel(b: string, level: Level): Promise<Level> {
  const parsed = Level.parse(level);
  await writeJson(path.join(paths.canonical(b), "levels", `${safe(parsed.id)}.json`), parsed);
  return parsed;
}

export interface LevelSummary {
  id: string;
  displayName: string;
  sortIndex: number;
  verified: boolean;
  hasPhoto: boolean;
  hasRectified: boolean;
  hasProposal: boolean;
  edited: boolean;
  hasNewerAuto: boolean;
  rooms: number;
  numberedRooms: number;
  components: number;
  openReview: number;
  totalReview: number;
  blockers: string[];
  aligned: boolean;
  accepted: boolean;
}

export async function levelSummaries(b: string): Promise<LevelSummary[]> {
  const cfg = await loadConfig(b);
  const alignment = await readAlignment(b);
  const out: LevelSummary[] = [];
  for (const lv of [...cfg.levels].sort((x, y) => x.sortIndex - y.sortIndex)) {
    const dir = paths.work(b, lv.id);
    const hasProposal = await exists(path.join(dir, "proposal.json"));
    let proposal: Proposal | null = null;
    let items: ReviewItem[] = [];
    if (hasProposal) {
      proposal = await readProposal(b, lv.id);
      items = (await readQueue(b, lv.id)).items;
    }
    out.push({
      id: lv.id,
      displayName: lv.displayName,
      sortIndex: lv.sortIndex,
      verified: lv.verified,
      hasPhoto: await exists(path.join(paths.raw(b), lv.photo)),
      hasRectified: await exists(path.join(dir, "rectified.png")),
      hasProposal,
      edited: Boolean(proposal?.editedAt),
      hasNewerAuto: await exists(path.join(dir, "proposal.auto.json")),
      rooms: proposal?.rooms.length ?? 0,
      numberedRooms: proposal?.rooms.filter((r) => r.number).length ?? 0,
      components: proposal ? components(proposal).length : 0,
      openReview: items.filter((i) => !i.resolved).length,
      totalReview: items.length,
      blockers: proposal ? acceptBlockers(proposal, items) : ["no proposal yet: run the pipeline"],
      aligned: Boolean(alignment.levels[lv.id]?.transform),
      accepted: await exists(path.join(paths.canonical(b), "levels", `${lv.id}.json`)),
    });
  }
  return out;
}

/** Files the UI may load from a level work dir (images for display and review crops). */
export async function workFile(b: string, l: string, rel: string[]): Promise<{ data: Buffer; type: string }> {
  const allowedTop = new Set(["rectified.png", "rectified.jpg", "ingest.png", "ingest.jpg", "review-crops", "debug"]);
  if (!rel.length || !allowedTop.has(rel[0]!)) throw new BadRequest("file not allowed");
  const cleaned = rel.map((s) => {
    if (!/^[A-Za-z0-9_.-]+$/.test(s) || s.includes("..")) throw new BadRequest("bad file path");
    return s;
  });
  const file = path.join(paths.work(b, l), ...cleaned);
  try {
    const data = await fs.readFile(file);
    return { data, type: file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream" };
  } catch {
    throw new NotFound(cleaned.join("/"));
  }
}

export async function ingestSize(b: string, l: string): Promise<{ corners: [number, number][] | null; size: [number, number] | null }> {
  const dir = paths.work(b, l);
  const rect = (await exists(path.join(dir, "rectify.json"))) ? JSON.parse(await fs.readFile(path.join(dir, "rectify.json"), "utf8")) : null;
  const ingest = (await exists(path.join(dir, "ingest.json"))) ? JSON.parse(await fs.readFile(path.join(dir, "ingest.json"), "utf8")) : null;
  return { corners: rect?.corners ?? null, size: ingest?.size ?? null };
}

export async function saveCorners(b: string, l: string, corners: [number, number][]): Promise<void> {
  if (corners.length !== 4 || corners.some((c) => c.length !== 2 || c.some((v) => !Number.isFinite(v)))) throw new BadRequest("need 4 [x, y] corners");
  await writeJson(path.join(paths.work(b, l), "corners.json"), { corners });
}
