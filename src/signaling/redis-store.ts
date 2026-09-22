import { Redis } from "@upstash/redis";
import { safeEqual } from "@/cloud/compare";
import { MAX_CLOUD_UPDATES } from "@/cloud/limits";
import { randomSecret } from "@/lib/room";
import { MAILBOX_CAP, MAILBOX_TTL_MS, PEER_TTL_MS, type RosterEntry, type SignalEnvelope } from "@/types/signaling";
import type { CloudPublic, CloudUnlocked, CloudWriteResult, SignalingStore } from "@/signaling/store";

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

function metaKey(env: string, roomId: string): string {
  return `doc:${env}:${roomId}:meta`;
}

function logKey(env: string, roomId: string): string {
  return `doc:${env}:${roomId}:log`;
}

type CloudMeta = { signalSecret: string; protected: boolean; salt: string; verifier: string };

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

  async readCloud(env: string, roomId: string): Promise<CloudPublic> {
    const meta = await this.ensureCloud(env, roomId);
    if (meta.protected) return { protected: true, salt: meta.salt };
    return { protected: false, signalSecret: meta.signalSecret, updates: await this.readLog(env, roomId) };
  }

  async unlockCloud(env: string, roomId: string, verifier: string): Promise<CloudUnlocked | null> {
    const meta = await this.ensureCloud(env, roomId);
    if (meta.protected && !safeEqual(meta.verifier, verifier)) return null;
    return {
      signalSecret: meta.signalSecret,
      updates: await this.readLog(env, roomId),
      salt: meta.protected ? meta.salt : null,
    };
  }

  async appendCloud(env: string, roomId: string, update: string, verifier: string | null): Promise<CloudWriteResult> {
    const meta = await this.ensureCloud(env, roomId);
    if (!this.allowsWrite(meta, verifier)) return "denied";
    const key = logKey(env, roomId);
    const length = await this.redis.rpush(key, update);
    if (length > MAX_CLOUD_UPDATES) {
      await this.redis.ltrim(key, 0, -2);
      return "full";
    }
    return "ok";
  }

  async compactCloud(
    env: string,
    roomId: string,
    expectedLength: number,
    snapshot: string,
    verifier: string | null,
  ): Promise<CloudWriteResult> {
    const meta = await this.ensureCloud(env, roomId);
    if (!this.allowsWrite(meta, verifier)) return "denied";
    const replaced = await this.redis.eval<[string, string], number>(
      "if redis.call('LLEN', KEYS[1]) ~= tonumber(ARGV[1]) then return 0 end redis.call('DEL', KEYS[1]) redis.call('RPUSH', KEYS[1], ARGV[2]) return 1",
      [logKey(env, roomId)],
      [String(expectedLength), snapshot],
    );
    return Number(replaced) === 1 ? "ok" : "full";
  }

  async protectCloud(
    env: string,
    roomId: string,
    salt: string,
    verifier: string,
    snapshot: string,
    previousVerifier: string | null,
  ): Promise<boolean> {
    const meta = await this.ensureCloud(env, roomId);
    if (meta.protected && (previousVerifier == null || !safeEqual(meta.verifier, previousVerifier))) return false;
    const key = logKey(env, roomId);
    await this.redis.hset(metaKey(env, roomId), { protected: "1", salt, verifier });
    await this.redis.del(key);
    await this.redis.rpush(key, snapshot);
    return true;
  }

  async unprotectCloud(env: string, roomId: string, verifier: string, snapshot: string): Promise<boolean> {
    const meta = await this.ensureCloud(env, roomId);
    if (!meta.protected || !safeEqual(meta.verifier, verifier)) return false;
    const key = logKey(env, roomId);
    await this.redis.hset(metaKey(env, roomId), { protected: "0", salt: "", verifier: "" });
    await this.redis.del(key);
    await this.redis.rpush(key, snapshot);
    return true;
  }

  private async ensureCloud(env: string, roomId: string): Promise<CloudMeta> {
    const key = metaKey(env, roomId);
    const secret = randomSecret();
    await this.redis.hsetnx(key, "signalSecret", secret);
    const raw = (await this.redis.hgetall<Record<string, unknown>>(key)) ?? {};
    if (typeof raw.signalSecret !== "string" || raw.signalSecret.length === 0) {
      await this.redis.hset(key, { signalSecret: secret, protected: "0", salt: "", verifier: "" });
    }
    const again = (await this.redis.hgetall<Record<string, unknown>>(key)) ?? raw;
    return {
      signalSecret: String(again.signalSecret ?? secret),
      protected: again.protected === "1" || again.protected === 1 || again.protected === true,
      salt: typeof again.salt === "string" ? again.salt : "",
      verifier: typeof again.verifier === "string" ? again.verifier : "",
    };
  }

  private async readLog(env: string, roomId: string): Promise<string[]> {
    const raw = await this.redis.lrange<unknown>(logKey(env, roomId), 0, -1);
    return raw.filter((item): item is string => typeof item === "string");
  }

  private allowsWrite(meta: CloudMeta, verifier: string | null): boolean {
    if (!meta.protected) return true;
    return verifier != null && safeEqual(meta.verifier, verifier);
  }
}

export function createRedisStore(): RedisSignalingStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured");
  return new RedisSignalingStore(new Redis({ url, token }));
}
