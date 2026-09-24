/**
 * Search over a building: room numbers, names and aliases, entrances, and "nearest X" queries.
 * "nearest restroom" only makes sense with somewhere to start from, so those results carry `needsFrom`.
 */
import type { PoiKind } from "@wf/schema";
import Fuse from "fuse.js";
import type { BuildingData } from "./data";

export interface SearchResult {
  /** What the app routes to. */
  target: { type: "room"; id: string } | { type: "entrance"; id: string } | { type: "nearest"; kind: PoiKind };
  label: string;
  detail: string;
  /** "nearest X" needs a starting point before it can be resolved. */
  needsFrom?: boolean;
}

interface Entry extends SearchResult {
  /** Fields fuse.js matches against. */
  number: string;
  name: string;
  aliases: string[];
  level: string;
}

const NEAREST: { kind: PoiKind; words: string[]; label: string }[] = [
  { kind: "restroom", words: ["restroom", "bathroom", "toilet", "washroom", "wc"], label: "Nearest restroom" },
  { kind: "accessible-restroom", words: ["accessible restroom", "accessible bathroom", "wheelchair restroom"], label: "Nearest accessible restroom" },
  { kind: "gender-inclusive-restroom", words: ["gender inclusive restroom", "all gender restroom", "neutral restroom"], label: "Nearest all-gender restroom" },
  { kind: "elevator", words: ["elevator", "lift"], label: "Nearest elevator" },
  { kind: "lactation", words: ["lactation room", "nursing room"], label: "Nearest lactation room" },
  { kind: "exit", words: ["exit", "way out"], label: "Nearest exit" },
];

export function buildIndex(data: BuildingData): { entries: Entry[]; fuse: Fuse<Entry> } {
  const levelName = (id: string) => data.levels.find((l) => l.id === id)?.displayName ?? id;
  const entries: Entry[] = [];

  for (const level of data.levels) {
    for (const room of level.rooms) {
      if (room.category === "service") continue; // mechanical spaces are not destinations
      const number = room.number ?? "";
      const name = room.name ?? "";
      entries.push({
        target: { type: "room", id: room.id },
        label: number ? `${data.building.name} ${number}` : name,
        detail: [name && number ? name : "", `Level ${levelName(level.id)}`].filter(Boolean).join(" · "),
        number,
        name,
        aliases: room.aliases,
        level: levelName(level.id),
      });
    }
  }
  for (const entrance of data.building.entrances) {
    entries.push({
      target: { type: "entrance", id: entrance.id },
      label: entrance.name,
      detail: entrance.accessible ? "Entrance · step-free" : "Entrance",
      number: "",
      name: entrance.name,
      aliases: [],
      level: "",
    });
  }

  const fuse = new Fuse(entries, {
    keys: [
      { name: "number", weight: 3 },
      { name: "name", weight: 2 },
      { name: "aliases", weight: 2 },
      { name: "label", weight: 1 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 1,
  });
  return { entries, fuse };
}

/** "nearest restroom", "closest lift", or just "restroom". */
function nearestMatches(query: string): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const out: SearchResult[] = [];
  for (const option of NEAREST) {
    const hit = option.words.some((w) => q.includes(w) || w.includes(q));
    if (!hit) continue;
    // A bare "restroom" offers the nearest one too, just below any room actually called that.
    out.push({ target: { type: "nearest", kind: option.kind }, label: option.label, detail: "From where you start", needsFrom: true });
  }
  return out;
}

export function search(index: { entries: Entry[]; fuse: Fuse<Entry> }, query: string, limit = 8): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const nearest = nearestMatches(q);
  const asked = /\b(nearest|closest|nearby)\b/.test(q.toLowerCase());
  // Strip the "nearest" words before matching rooms, so "nearest elevator" still ranks rooms sensibly.
  const cleaned = q.replace(/\b(nearest|closest|nearby|near me)\b/gi, "").trim();
  const matches = cleaned ? index.fuse.search(cleaned, { limit }).map((m) => m.item as SearchResult) : [];
  const results = asked ? [...nearest, ...matches] : [...matches, ...nearest];
  return results.slice(0, limit);
}
