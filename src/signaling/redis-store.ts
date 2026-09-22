import { Redis } from "@upstash/redis";
import { MAILBOX_CAP, MAILBOX_TTL_MS, PEER_TTL_MS, type RosterEntry, type SignalEnvelope } from "@/types/signaling";
import type { SignalingStore } from "@/signaling/store";

type StoredEnvelope = SignalEnvelope & { exp: number };

function peersKey(env: string, roomId: string): string {
  return `sig:${env}:${roomId}:peers`;
}

function joinedKey(env: string, roomId: string): string {
  return `sig:${env}:${roomId}:joined`;
}

function mailboxKey(env: string, roomId: string, peerId: string): string {
  return `sig:${env}:${roomId}:mbox:${peerId}`;
}

function asEnvelope(value: unknown): StoredEnvelope | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as StoredEnvelope;
  if (
    typeof envelope.to !== "string" ||
    typeof envelope.from !== "string" ||
    typeof envelope.id !== "string" ||
    typeof envelope.body !== "string" ||
    typeof envelope.exp !== "number"
  ) {
    return null;
  }
  return envelope;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class RedisSignalingStore implements SignalingStore {
  constructor(private readonly redis: Redis) {}

  async heartbeat(env: string, roomId: string, peerId: string, now: number): Promise<void> {
    const peers = peersKey(env, roomId);
    const joined = joinedKey(env, roomId);
    await this.redis.hsetnx(joined, peerId, now);
    await this.redis.zadd(peers, { score: now + PEER_TTL_MS, member: peerId });
    await this.redis.expire(peers, Math.ceil(PEER_TTL_MS / 1000) * 4);
    await this.redis.expire(joined, Math.ceil(PEER_TTL_MS / 1000) * 4);
  }

  async remove(env: string, roomId: string, peerId: string): Promise<void> {
    await this.redis.zrem(peersKey(env, roomId), peerId);
    await this.redis.hdel(joinedKey(env, roomId), peerId);
    await this.redis.del(mailboxKey(env, roomId, peerId));
  }

  async roster(env: string, roomId: string, now: number): Promise<RosterEntry[]> {
    const peers = peersKey(env, roomId);
    const joined = joinedKey(env, roomId);
    const expired = await this.redis.zrange<string[]>(peers, "-inf", now, { byScore: true });
    if (expired.length > 0) {
      await this.redis.zremrangebyscore(peers, "-inf", now);
      await this.redis.hdel(joined, ...expired);
    }
    const live = await this.redis.zrange<string[]>(peers, now + 1, "+inf", { byScore: true });
    if (live.length === 0) return [];
    const joinedAt = (await this.redis.hgetall<Record<string, number | string>>(joined)) ?? {};
    return live
      .map((id) => ({ id, joinedAt: Number(joinedAt[id] ?? now) }))
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  }

  async post(env: string, roomId: string, envelope: SignalEnvelope, now: number): Promise<void> {
    const key = mailboxKey(env, roomId, envelope.to);
    const stored: StoredEnvelope = { ...envelope, exp: now + MAILBOX_TTL_MS };
    await this.redis.rpush(key, JSON.stringify(stored));
    await this.redis.ltrim(key, -MAILBOX_CAP, -1);
    await this.redis.expire(key, Math.ceil(MAILBOX_TTL_MS / 1000));
  }

  async drain(env: string, roomId: string, peerId: string, now: number): Promise<SignalEnvelope[]> {
    const key = mailboxKey(env, roomId, peerId);
    const raw = await this.redis.lrange<unknown[]>(key, 0, -1);
    if (raw.length > 0) {
      await this.redis.ltrim(key, raw.length, -1);
    }
    const envelopes: SignalEnvelope[] = [];
    for (const item of raw) {
      const stored = asEnvelope(item);
      if (!stored || stored.exp <= now || stored.to !== peerId) continue;
      envelopes.push({ to: stored.to, from: stored.from, id: stored.id, body: stored.body });
    }
    return envelopes;
  }
}

export function createRedisStore(): RedisSignalingStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured");
  return new RedisSignalingStore(new Redis({ url, token }));
}
