"use client";
import type { Alignment, Building, BuildingConfig, Level, Proposal, ReviewQueue } from "@wf/schema";
import type { LevelSummary, OsmFootprint } from "./server/data";

export type { LevelSummary, OsmFootprint };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

const lvl = (b: string, l: string) => `/api/b/${b}/levels/${l}`;

export const api = {
  building: (b: string) =>
    call<{ config: BuildingConfig; levels: LevelSummary[]; alignment: Alignment; osm: OsmFootprint | null; building: Building | null }>(`/api/b/${b}`),
  proposal: (b: string, l: string, auto = false) => call<Proposal>(`${lvl(b, l)}/proposal${auto ? "?auto=1" : ""}`),
  saveProposal: (b: string, l: string, p: Proposal) => call<Proposal>(`${lvl(b, l)}/proposal`, { method: "PUT", body: JSON.stringify(p) }),
  queue: (b: string, l: string) => call<ReviewQueue>(`${lvl(b, l)}/review`),
  saveQueue: (b: string, l: string, q: ReviewQueue) => call<ReviewQueue>(`${lvl(b, l)}/review`, { method: "PUT", body: JSON.stringify(q) }),
  reset: (b: string, l: string) => call<Proposal>(`${lvl(b, l)}/reset`, { method: "POST" }),
  corners: (b: string, l: string) => call<{ corners: [number, number][] | null; size: [number, number] | null }>(`${lvl(b, l)}/corners`),
  saveCorners: (b: string, l: string, corners: [number, number][]) => call(`${lvl(b, l)}/corners`, { method: "PUT", body: JSON.stringify({ corners }) }),
  run: (b: string, l: string, fromStage?: string, toStage?: string) =>
    call<{ ok: boolean; ran: string[]; log: string; error?: string; failedStage?: string }>(`${lvl(b, l)}/run`, { method: "POST", body: JSON.stringify({ fromStage, toStage }) }),
  alignment: (b: string) => call<Alignment>(`/api/b/${b}/alignment`),
  saveAlignment: (b: string, a: Alignment) => call<Alignment>(`/api/b/${b}/alignment`, { method: "PUT", body: JSON.stringify(a) }),
  fetchOsm: (b: string) => call<OsmFootprint>(`/api/b/${b}/osm`, { method: "POST" }),
  accept: (b: string, levels?: string[]) =>
    call<{ results: { level: string; ok: boolean; blockers: string[] }[]; building: Building | null }>(`/api/b/${b}/accept`, { method: "POST", body: JSON.stringify({ levels }) }),
  canonical: (b: string) => call<{ building: Building | null; levels: Level[] }>(`/api/b/${b}/canonical`),
  saveCanonical: (b: string, building: Building, levels: Level[]) => call(`/api/b/${b}/canonical`, { method: "PUT", body: JSON.stringify({ building, levels }) }),
};

export const fileUrl = (b: string, l: string, rel: string, bust?: string | number) => `${lvl(b, l)}/files/${rel}${bust ? `?v=${bust}` : ""}`;
