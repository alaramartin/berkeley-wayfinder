/** Apply a human answer to a review item: updates the proposal and marks the item resolved. */
import type { Proposal, ProposalRoom, ReviewItem } from "@wf/schema";
import { roomIdForNumber } from "./ids";

export interface Answer {
  /** Room number, gender ("men" | "women" | "all"), "name = room" for aliases, or the icon kind. null = reject. */
  value: string | null;
  /** Restroom accessibility (restroom-gender items). */
  accessible?: boolean;
}

const RESTROOM_NAMES: Record<string, string> = { men: "Men's restroom", women: "Women's restroom", all: "All-gender restroom" };

function roomsForTarget(p: Proposal, targetId: string): ProposalRoom[] {
  return p.rooms.filter((r) => r.id === targetId || r.regionId === targetId);
}

export interface Applied {
  proposal: Proposal;
  item: ReviewItem;
  /** Set when the answer can't be applied as-is; the item stays unresolved and the UI shows this. */
  conflict?: string;
}

export function applyAnswer(p: Proposal, item: ReviewItem, answer: Answer, now = new Date().toISOString()): Applied {
  const resolved: ReviewItem = { ...item, resolved: { value: answer.value, at: now } };
  let proposal = p;

  switch (item.kind) {
    case "room-number": {
      const targets = roomsForTarget(p, item.targetId);
      if (answer.value === null) {
        // "Not a room": drop only unnumbered rooms for this region; keep numbers accepted elsewhere in a suite.
        proposal = { ...p, rooms: p.rooms.filter((r) => !(targets.includes(r) && r.number === null)) };
        break;
      }
      const number = answer.value.trim().toUpperCase();
      const elsewhere = p.rooms.find((r) => r.number === number && !targets.includes(r));
      if (elsewhere) {
        return {
          proposal: p,
          item,
          conflict: `Room ${number} already exists on this level (${elsewhere.id}). If both outlines are the same room, answer "Not a room" here, or fix the outlines in the editor.`,
        };
      }
      const unnumbered = targets.find((r) => r.number === null);
      const template = unnumbered ?? targets[0];
      if (!template) break;
      if (targets.some((r) => r.number === number)) break;
      const room: ProposalRoom = { ...template, id: roomIdForNumber(p, number), number, numberConfidence: 1, regionId: template.regionId ?? item.targetId };
      proposal = unnumbered ? { ...p, rooms: p.rooms.map((r) => (r === unnumbered ? room : r)) } : { ...p, rooms: [...p.rooms, room] };
      break;
    }
    case "restroom-gender": {
      if (answer.value === null) break;
      const gender = answer.value as "men" | "women" | "all";
      const ids = new Set(roomsForTarget(p, item.targetId).map((r) => r.id));
      proposal = {
        ...p,
        rooms: p.rooms.map((r) =>
          ids.has(r.id)
            ? { ...r, category: "restroom", restroom: { gender, accessible: answer.accessible ?? false }, name: r.name ?? RESTROOM_NAMES[gender] }
            : r,
        ),
      };
      break;
    }
    case "alias": {
      const original = item.candidates[0]?.value ?? "";
      const [oldName, oldRoom] = original.split(" = ").map((s) => s.trim());
      const directory = (p.directory ?? []).filter((d) => !(d.name === oldName && d.room === oldRoom));
      if (answer.value !== null) {
        const [name, room] = answer.value.split("=").map((s) => s.trim());
        if (name && room) directory.push({ name, room: room.toUpperCase(), confidence: 1 });
      }
      proposal = { ...p, directory };
      break;
    }
    case "icon": {
      proposal =
        answer.value === null
          ? { ...p, icons: p.icons.filter((i) => i.id !== item.targetId) }
          : { ...p, icons: p.icons.map((i) => (i.id === item.targetId ? { ...i, confidence: 1 } : i)) };
      break;
    }
  }
  return { proposal, item: resolved };
}

export function openItems(items: ReviewItem[]): ReviewItem[] {
  return items.filter((i) => !i.resolved);
}
