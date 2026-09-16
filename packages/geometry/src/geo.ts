import type { LatLon, Point } from "@wf/schema";

const EARTH_RADIUS_M = 6_378_137;
const DEG = Math.PI / 180;

/**
 * Local east/north meters around an origin (equirectangular). Error is far below
 * placard accuracy at building scale (< 1 mm over 200 m).
 */
export function toLocal(origin: LatLon, p: LatLon): Point {
  const x = (p.lon - origin.lon) * DEG * EARTH_RADIUS_M * Math.cos(origin.lat * DEG);
  const y = (p.lat - origin.lat) * DEG * EARTH_RADIUS_M;
  return [x, y];
}

export function toLatLon(origin: LatLon, [x, y]: Point): LatLon {
  return {
    lat: origin.lat + y / EARTH_RADIUS_M / DEG,
    lon: origin.lon + x / (EARTH_RADIUS_M * Math.cos(origin.lat * DEG)) / DEG,
  };
}
