/**
 * The edits made on the walk, kept on the phone.
 *
 * IndexedDB, so they survive a closed tab, a dead battery and no signal. Falls back to memory when the
 * browser refuses it (some private windows), and says which it is using so the screen can warn that
 * edits will not survive a reload.
 */
import type { PatchOp } from "@wf/schema";

export interface StoredOp {
  id: number;
  op: PatchOp;
  at: string;
}

export interface OpStore {
  kind: "indexeddb" | "memory";
  list(): Promise<StoredOp[]>;
  add(op: PatchOp): Promise<StoredOp>;
  remove(id: number): Promise<void>;
  clear(): Promise<void>;
}

export function memoryStore(): OpStore {
  let next = 1;
  let items: StoredOp[] = [];
  return {
    kind: "memory",
    list: async () => [...items],
    add: async (op) => {
      const stored = { id: next++, op, at: new Date().toISOString() };
      items.push(stored);
      return stored;
    },
    remove: async (id) => {
      items = items.filter((i) => i.id !== id);
    },
    clear: async () => {
      items = [];
    },
  };
}

const STORE = "ops";

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export async function openStore(buildingId: string): Promise<OpStore> {
  try {
    if (typeof indexedDB === "undefined") return memoryStore();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(`wf-field-${buildingId}`, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("blocked"));
    });
    const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
    return {
      kind: "indexeddb",
      list: async () => ((await request(tx("readonly").getAll())) as StoredOp[]).sort((a, b) => a.id - b.id),
      add: async (op) => {
        const record = { op, at: new Date().toISOString() };
        const id = (await request(tx("readwrite").add(record))) as number;
        return { id, ...record };
      },
      remove: async (id) => void (await request(tx("readwrite").delete(id))),
      clear: async () => void (await request(tx("readwrite").clear())),
    };
  } catch {
    return memoryStore();
  }
}
