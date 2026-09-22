import * as Y from "yjs";
import { appendCloud, compactCloud, fetchCloud, unlockCloud } from "@/cloud/client";
import { decryptBytes, encryptBytes } from "@/cloud/password";
import { base64ToBytes, bytesToBase64 } from "@/lib/bytes";
import type { CloudUnlocked } from "@/signaling/store";

export const CLOUD_ORIGIN: unique symbol = Symbol("cloud");

export class CloudSync {
  private pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private pulling = false;
  private writing = false;
  private paused = false;
  private length = 0;
  private marker = "";

  constructor(
    private readonly doc: Y.Doc,
    private readonly roomId: string,
    private key: CryptoKey | null,
    private verifier: string | null,
  ) {}

  note(update: Uint8Array): void {
    if (this.stopped) return;
    this.pending.push(update);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 400);
  }

  async applyEncoded(updates: string[]): Promise<void> {
    this.length = updates.length;
    this.marker = markerFor(updates);
    for (const update of updates) {
      const bytes = await decodeUpdate(update, this.key);
      if (bytes) Y.applyUpdate(this.doc, bytes, CLOUD_ORIGIN);
    }
  }

  async pull(): Promise<boolean> {
    if (this.stopped || this.pulling) return true;
    this.pulling = true;
    try {
      const remote = await this.load();
      if (!remote) return false;
      const marker = markerFor(remote.updates);
      if (marker === this.marker) return true;
      await this.applyEncoded(remote.updates);
      return true;
    } catch {
      return false;
    } finally {
      this.pulling = false;
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.paused || this.pending.length === 0) return;
    this.writing = true;
    const batch = this.pending.splice(0);
    try {
      const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
      const body = await this.encode(merged);
      const result = await appendCloud(this.roomId, body, this.verifier);
      if (result === "full") {
        await this.pull();
        const snapshot = await this.encode(Y.encodeStateAsUpdate(this.doc));
        const compacted = await compactCloud(this.roomId, this.length, snapshot, this.verifier);
        if (!compacted) this.pending.unshift(...batch);
        else this.length = 1;
        return;
      }
      this.length += 1;
      this.marker = "";
    } catch {
      this.pending.unshift(...batch);
    } finally {
      this.writing = false;
    }
  }

  async settle(): Promise<void> {
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.writing) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  resume(): void {
    this.paused = false;
  }

  markProtected(key: CryptoKey, verifier: string): void {
    this.key = key;
    this.verifier = verifier;
    this.length = 1;
    this.marker = "";
  }

  markOpen(): void {
    this.key = null;
    this.verifier = null;
    this.length = 1;
    this.marker = "";
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.flush();
    this.stopped = true;
  }

  private async load(): Promise<CloudUnlocked | null> {
    if (this.verifier) return unlockCloud(this.roomId, this.verifier);
    const cloud = await fetchCloud(this.roomId);
    if (cloud.protected) return null;
    return { signalSecret: cloud.signalSecret, updates: cloud.updates, salt: null };
  }

  private encode(bytes: Uint8Array): Promise<string> {
    return this.key ? encryptBytes(this.key, bytes) : Promise.resolve(bytesToBase64(bytes));
  }
}

async function decodeUpdate(body: string, key: CryptoKey | null): Promise<Uint8Array | null> {
  if (key) return decryptBytes(key, body);
  return base64ToBytes(body);
}

function markerFor(updates: string[]): string {
  return `${updates.length}:${updates[updates.length - 1] ?? ""}`;
}
