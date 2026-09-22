import { getMemoryStore, resetMemoryStore } from "@/signaling/memory-store";
import { createRedisStore } from "@/signaling/redis-store";
import type { SignalingStore } from "@/signaling/store";

export type StoreMode = "redis" | "memory" | "unconfigured";

export type StoreEnv = {
  nodeEnv?: string;
  vercelEnv?: string;
  redisUrl?: string;
  redisToken?: string;
};

export class SignalingConfigError extends Error {
  constructor() {
    super("Redis is not configured");
    this.name = "SignalingConfigError";
  }
}

export function storeMode(env: StoreEnv): StoreMode {
  const hasRedis = Boolean(env.redisUrl && env.redisToken);
  const hosted =
    env.vercelEnv === "production" ||
    env.vercelEnv === "preview" ||
    env.nodeEnv === "production";
  if (hasRedis) return "redis";
  if (hosted) return "unconfigured";
  return "memory";
}

export function signalingEnvironment(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

function currentEnv(): StoreEnv {
  return {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    redisUrl: process.env.UPSTASH_REDIS_REST_URL,
    redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

let redisStore: SignalingStore | null = null;

export function getSignalingStore(): SignalingStore {
  const mode = storeMode(currentEnv());
  if (mode === "unconfigured") throw new SignalingConfigError();
  if (mode === "redis") {
    if (!redisStore) redisStore = createRedisStore();
    return redisStore;
  }
  return getMemoryStore();
}

export function resetSignalingStoreForTests(): void {
  redisStore = null;
  resetMemoryStore();
}
