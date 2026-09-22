import { MAILBOX_CAP, MAILBOX_TTL_MS, PEER_TTL_MS, type RosterEntry, type SignalEnvelope } from "@/types/signaling";
import type { SignalingStore } from "@/signaling/store";

type Presence = { expiry: number; joinedAt: number };
type StoredEnvelope = SignalEnvelope & { exp: number };

export class MemorySignalingStore implements SignalingStore {
  private presence = new Map<string, Map<string, Presence>>();
  private mailboxes = new Map<string, StoredEnvelope[]>();

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

  private mailboxKey(env: string, roomId: string, peerId: string): string {
    return `sig:${env}:${roomId}:mbox:${peerId}`;
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
