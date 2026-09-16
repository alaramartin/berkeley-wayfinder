/** Writes JSON Schema for every top-level shape so the Python pipeline validates against the same source of truth. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Building, BuildingConfig, Level, Patch, Proposal, ReviewQueue } from "../src/index";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
mkdirSync(outDir, { recursive: true });

const shapes = { building: Building, level: Level, proposal: Proposal, "review-queue": ReviewQueue, patch: Patch, "building-config": BuildingConfig };
for (const [name, schema] of Object.entries(shapes)) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote schema/${name}.json`);
}
