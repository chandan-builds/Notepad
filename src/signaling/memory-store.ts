import { safeEqual } from "@/cloud/compare";
import { MAX_CLOUD_UPDATES } from "@/cloud/limits";
import { randomSecret } from "@/lib/room";
import { MAILBOX_CAP, MAILBOX_TTL_MS, PEER_TTL_MS, type RosterEntry, type SignalEnvelope } from "@/types/signaling";
import type { CloudPublic, CloudUnlocked, CloudWriteResult, SignalingStore } from "@/signaling/store";

type Presence = { expiry: number; joinedAt: number };
type StoredEnvelope = SignalEnvelope & { exp: number };

type CloudRecord = {
  signalSecret: string;
  protected: boolean;
  salt: string;
  verifier: string;
  updates: string[];
};

export class MemorySignalingStore implements SignalingStore {
  private presence = new Map<string, Map<string, Presence>>();
  private mailboxes = new Map<string, StoredEnvelope[]>();
  private clouds = new Map<string, CloudRecord>();
  private paths = new Map<string, string>();
  private roomPaths = new Map<string, string>();

  async heartbeat(env: string, roomId: string, peerId: string, now: number): Promise<void> {
    const room = this.roomPresence(env, roomId);
    const current = room.get(peerId);
    room.set(peerId, {
      joinedAt: current?.joinedAt ?? now,
      expiry: now + PEER_TTL_MS,
    });
  }

  async remove(env: string, roomId: string, peerId: string): Promise<void> {
    this.roomPresence(env, roomId).delete(peerId);
    this.mailboxes.delete(this.mailboxKey(env, roomId, peerId));
  }

  async roster(env: string, roomId: string, now: number): Promise<RosterEntry[]> {
    const room = this.roomPresence(env, roomId);
    const live: RosterEntry[] = [];
    for (const [id, presence] of room) {
      if (presence.expiry <= now) {
        room.delete(id);
        continue;
      }
      live.push({ id, joinedAt: presence.joinedAt });
    }
    live.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    return live;
  }

  async post(env: string, roomId: string, envelope: SignalEnvelope, now: number): Promise<void> {
    const key = this.mailboxKey(env, roomId, envelope.to);
    const mailbox = (this.mailboxes.get(key) ?? []).filter((item) => item.exp > now);
    mailbox.push({ ...envelope, exp: now + MAILBOX_TTL_MS });
    this.mailboxes.set(key, mailbox.slice(-MAILBOX_CAP));
  }

  async drain(env: string, roomId: string, peerId: string, now: number): Promise<SignalEnvelope[]> {
    const key = this.mailboxKey(env, roomId, peerId);
    const mailbox = this.mailboxes.get(key) ?? [];
    this.mailboxes.delete(key);
    return mailbox
      .filter((item) => item.exp > now)
      .map(({ to, from, id, body }) => ({ to, from, id, body }));
  }

  private roomPresence(env: string, roomId: string): Map<string, Presence> {
    const key = `sig:${env}:${roomId}:peers`;
    let room = this.presence.get(key);
    if (!room) {
      room = new Map();
      this.presence.set(key, room);
    }
    return room;
  }

  async readCloud(env: string, roomId: string): Promise<CloudPublic> {
    const record = this.cloud(env, roomId);
    if (record.protected) return { protected: true, salt: record.salt };
    return { protected: false, signalSecret: record.signalSecret, updates: [...record.updates] };
  }

  async unlockCloud(env: string, roomId: string, verifier: string): Promise<CloudUnlocked | null> {
    const record = this.cloud(env, roomId);
    if (record.protected && !safeEqual(record.verifier, verifier)) return null;
    return {
      signalSecret: record.signalSecret,
      updates: [...record.updates],
      salt: record.protected ? record.salt : null,
    };
  }

  async appendCloud(env: string, roomId: string, update: string, verifier: string | null): Promise<CloudWriteResult> {
    const record = this.cloud(env, roomId);
    if (!this.allowsWrite(record, verifier)) return "denied";
    if (record.updates.length >= MAX_CLOUD_UPDATES) return "full";
    record.updates.push(update);
    return "ok";
  }

  async compactCloud(
    env: string,
    roomId: string,
    expectedLength: number,
    snapshot: string,
    verifier: string | null,
  ): Promise<CloudWriteResult> {
    const record = this.cloud(env, roomId);
    if (!this.allowsWrite(record, verifier)) return "denied";
    if (record.updates.length !== expectedLength) return "full";
    record.updates = [snapshot];
    return "ok";
  }

  async protectCloud(
    env: string,
    roomId: string,
    salt: string,
    verifier: string,
    snapshot: string,
    previousVerifier: string | null,
  ): Promise<boolean> {
    const record = this.cloud(env, roomId);
    if (record.protected && (previousVerifier == null || !safeEqual(record.verifier, previousVerifier))) return false;
    record.protected = true;
    record.salt = salt;
    record.verifier = verifier;
    record.updates = [snapshot];
    return true;
  }

  async claimPath(env: string, roomId: string, slug: string): Promise<"ok" | "taken"> {
    const key = `${env}:${slug}`;
    const owner = this.paths.get(key);
    if (owner && owner !== roomId) return "taken";
    const roomKey = `${env}:${roomId}`;
    const previous = this.roomPaths.get(roomKey);
    if (previous && previous !== slug) this.paths.delete(`${env}:${previous}`);
    this.paths.set(key, roomId);
    this.roomPaths.set(roomKey, slug);
    return "ok";
  }

  async resolvePath(env: string, slug: string): Promise<string | null> {
    return this.paths.get(`${env}:${slug}`) ?? null;
  }

  async unprotectCloud(env: string, roomId: string, verifier: string, snapshot: string): Promise<boolean> {
    const record = this.cloud(env, roomId);
    if (!record.protected || !safeEqual(record.verifier, verifier)) return false;
    record.protected = false;
    record.salt = "";
    record.verifier = "";
    record.updates = [snapshot];
    return true;
  }

  private mailboxKey(env: string, roomId: string, peerId: string): string {
    return `sig:${env}:${roomId}:mbox:${peerId}`;
  }

  private cloud(env: string, roomId: string): CloudRecord {
    const key = `doc:${env}:${roomId}`;
    let record = this.clouds.get(key);
    if (!record) {
      record = { signalSecret: randomSecret(), protected: false, salt: "", verifier: "", updates: [] };
      this.clouds.set(key, record);
    }
    return record;
  }

  private allowsWrite(record: CloudRecord, verifier: string | null): boolean {
    if (!record.protected) return true;
    return verifier != null && safeEqual(record.verifier, verifier);
  }
}

const globalStore = globalThis as typeof globalThis & {
  __collabMemorySignaling?: MemorySignalingStore;
};

export function getMemoryStore(): MemorySignalingStore {
  if (!globalStore.__collabMemorySignaling) {
    globalStore.__collabMemorySignaling = new MemorySignalingStore();
  }
  return globalStore.__collabMemorySignaling;
}

export function resetMemoryStore(): void {
  globalStore.__collabMemorySignaling = new MemorySignalingStore();
}
