import { describe, expect, it } from "vitest";
import { MemorySignalingStore } from "@/signaling/memory-store";
import { storeMode } from "@/signaling/get-store";
import { MAILBOX_CAP, MAILBOX_TTL_MS, PEER_TTL_MS } from "@/types/signaling";

const env = "test";
const roomId = "room-does-not-matter";
const peerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const peerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("memory signaling store", () => {
  it("expires presence and keeps the original join time", async () => {
    const store = new MemorySignalingStore();
    await store.heartbeat(env, roomId, peerA, 1_000);
    await store.heartbeat(env, roomId, peerA, 1_000 + 5_000);
    const live = await store.roster(env, roomId, 1_000 + 10_000);
    expect(live).toEqual([{ id: peerA, joinedAt: 1_000 }]);

    const expired = await store.roster(env, roomId, 1_000 + 5_000 + PEER_TTL_MS);
    expect(expired).toEqual([]);
  });

  it("delivers a mailbox only to the addressed peer and caps it", async () => {
    const store = new MemorySignalingStore();
    await store.post(env, roomId, { to: peerA, from: peerB, id: "1", body: "cipher-a" }, 0);
    await store.post(env, roomId, { to: peerB, from: peerA, id: "2", body: "cipher-b" }, 0);

    expect(await store.drain(env, roomId, peerA, 0)).toEqual([
      { to: peerA, from: peerB, id: "1", body: "cipher-a" },
    ]);
    expect(await store.drain(env, roomId, peerA, 0)).toEqual([]);
    expect(await store.drain(env, roomId, peerB, 0)).toEqual([
      { to: peerB, from: peerA, id: "2", body: "cipher-b" },
    ]);

    for (let index = 0; index < MAILBOX_CAP + 10; index += 1) {
      await store.post(
        env,
        roomId,
        { to: peerA, from: peerB, id: `m-${index}`, body: `b-${index}` },
        10,
      );
    }
    const drained = await store.drain(env, roomId, peerA, 10);
    expect(drained).toHaveLength(MAILBOX_CAP);
    expect(drained[0]?.id).toBe("m-10");
    expect(drained.at(-1)?.id).toBe(`m-${MAILBOX_CAP + 9}`);
  });

  it("drops expired envelopes", async () => {
    const store = new MemorySignalingStore();
    await store.post(env, roomId, { to: peerA, from: peerB, id: "old", body: "x" }, 0);
    expect(await store.drain(env, roomId, peerA, MAILBOX_TTL_MS)).toEqual([]);
  });
});

describe("store mode", () => {
  it("uses memory in development and refuses a hosted deploy without Redis", () => {
    expect(storeMode({ nodeEnv: "development" })).toBe("memory");
    expect(storeMode({ nodeEnv: "test" })).toBe("memory");
    expect(storeMode({ nodeEnv: "production" })).toBe("unconfigured");
    expect(storeMode({ vercelEnv: "preview" })).toBe("unconfigured");
    expect(
      storeMode({
        nodeEnv: "production",
        vercelEnv: "production",
        redisUrl: "https://example.upstash.io",
        redisToken: "token",
      }),
    ).toBe("redis");
  });
});
