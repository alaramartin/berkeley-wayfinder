/**
 * Copy canonical building data into public/ so the app (and, in M5, the offline shell) can fetch it.
 * Runs before dev and build; the copy is generated, never edited by hand.
 */
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const source = path.join(root, "data", "buildings");
const target = path.join(root, "apps", "nav", "public", "data");

const buildings = (await readdir(source, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const id of buildings) await cp(path.join(source, id), path.join(target, id), { recursive: true });
await writeFile(path.join(target, "index.json"), `${JSON.stringify({ buildings }, null, 2)}\n`);
console.log(`bundled ${buildings.length} building(s) into public/data: ${buildings.join(", ")}`);
