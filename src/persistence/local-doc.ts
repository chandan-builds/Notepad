import { IndexeddbPersistence, clearDocument } from "y-indexeddb";
import * as Y from "yjs";
import { detectIndexedDB } from "@/lib/support";

const OPEN_TIMEOUT_MS = 8_000;

export type LocalDocStatus = "ok" | "reset" | "unavailable";

export type LocalDoc = {
  doc: Y.Doc;
  persistence: IndexeddbPersistence | null;
  status: LocalDocStatus;
};

export async function openLocalDoc(roomId: string, doc: Y.Doc): Promise<LocalDoc> {
  if (!detectIndexedDB()) {
    return { doc, persistence: null, status: "unavailable" };
  }
  const first = new IndexeddbPersistence(roomId, doc);
  try {
    await withTimeout(first._db, OPEN_TIMEOUT_MS);
    await withTimeout(first.whenSynced, OPEN_TIMEOUT_MS);
    return { doc, persistence: first, status: "ok" };
  } catch {
    await discard(first, roomId);
  }

  const fresh = new Y.Doc();
  const second = new IndexeddbPersistence(roomId, fresh);
  try {
    await withTimeout(second._db, OPEN_TIMEOUT_MS);
    await withTimeout(second.whenSynced, OPEN_TIMEOUT_MS);
    return { doc: fresh, persistence: second, status: "reset" };
  } catch {
    await discard(second, roomId);
    return { doc: fresh, persistence: null, status: "unavailable" };
  }
}

export async function wipeLocalDoc(roomId: string, persistence: IndexeddbPersistence | null): Promise<void> {
  if (persistence) await discard(persistence, roomId);
  else await clearDocument(roomId).catch(() => undefined);
}

async function discard(persistence: IndexeddbPersistence, roomId: string): Promise<void> {
  try {
    await persistence.clearData();
  } catch {
    try {
      await persistence.destroy();
    } catch {
      /* the database may already be closed */
    }
    await clearDocument(roomId).catch(() => undefined);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("IndexedDB timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
