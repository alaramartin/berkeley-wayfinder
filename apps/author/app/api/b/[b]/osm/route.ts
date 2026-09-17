import { BadRequest, loadConfig, readOsm, saveOsm } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ b: string }> };

/** Search area for building names when no osmWayId is configured: the UC Berkeley campus. */
const CAMPUS_BBOX = "37.866,-122.268,37.879,-122.249";
const OVERPASS = "https://overpass-api.de/api/interpreter";

export async function GET(_req: Request, { params }: Ctx) {
  const { b } = await params;
  return handle(() => readOsm(b));
}

/** Fetch the building footprint from OpenStreetMap and cache it in data/buildings/<b>/osm.json. */
export async function POST(_req: Request, { params }: Ctx) {
  const { b } = await params;
  return handle(async () => {
    const cfg = await loadConfig(b);
    const escaped = cfg.name.replace(/[\\"]/g, "");
    const query = cfg.osmWayId
      ? `[out:json][timeout:25];way(${cfg.osmWayId});out geom tags;`
      : `[out:json][timeout:25];way["building"]["name"="${escaped}"](${CAMPUS_BBOX});out geom tags;`;
    const res = await fetch(OVERPASS, { method: "POST", body: new URLSearchParams({ data: query }), headers: { "user-agent": "berkeley-wayfinder-author/0.1" } });
    if (!res.ok) throw new BadRequest(`Overpass error ${res.status}`);
    const json = (await res.json()) as { elements: { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };
    const ways = json.elements.filter((e) => e.type === "way" && e.geometry?.length);
    if (ways.length !== 1) throw new BadRequest(`expected 1 OSM way for "${cfg.name}", found ${ways.length}; set osmWayId in config.yaml`);
    const way = ways[0]!;
    const osm = { wayId: way.id, name: way.tags?.name ?? null, fetchedAt: new Date().toISOString(), ring: way.geometry! };
    await saveOsm(b, osm);
    return osm;
  });
}
