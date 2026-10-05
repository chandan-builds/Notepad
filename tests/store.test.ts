import { describe, expect, it } from "vitest";
import { MAX_CLOUD_UPDATES } from "@/cloud/limits";
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

describe("cloud log", () => {
  const verifier = "v".repeat(44);
  const other = "w".repeat(44);

  it("hides updates after a password and rejects a compact with the wrong length", async () => {
    const store = new MemorySignalingStore();
    const created = await store.readCloud(env, roomId);
    expect(created.protected).toBe(false);
    if (created.protected) return;
    expect(created.updates).toEqual([]);
    expect(created.signalSecret).toHaveLength(22);

    expect(await store.appendCloud(env, roomId, "plain-update", null)).toBe("ok");
    expect(await store.protectCloud(env, roomId, "salt-value", verifier, "cipher-snapshot", null)).toBe(true);

    const hidden = await store.readCloud(env, roomId);
    expect(hidden).toEqual({ protected: true, salt: "salt-value" });
    expect(await store.unlockCloud(env, roomId, other)).toBeNull();
    expect(await store.appendCloud(env, roomId, "junk", null)).toBe("denied");
    expect(await store.appendCloud(env, roomId, "junk", other)).toBe("denied");

    const opened = await store.unlockCloud(env, roomId, verifier);
    expect(opened?.updates).toEqual(["cipher-snapshot"]);
    expect(opened?.signalSecret).toBe(created.signalSecret);

    expect(await store.compactCloud(env, roomId, 2, "next", verifier)).toBe("full");
    expect(await store.compactCloud(env, roomId, 1, "next", verifier)).toBe("ok");
    expect(await store.protectCloud(env, roomId, "other-salt", other, "replaced", null)).toBe(false);
    expect(await store.unprotectCloud(env, roomId, other, "plain")).toBe(false);
    expect(await store.unprotectCloud(env, roomId, verifier, "plain-snapshot")).toBe(true);
    const openAgain = await store.readCloud(env, roomId);
    expect(openAgain.protected).toBe(false);
    if (!openAgain.protected) expect(openAgain.updates).toEqual(["plain-snapshot"]);
  });

  it("stops accepting updates once the log is full", async () => {
    const store = new MemorySignalingStore();
    for (let index = 0; index < MAX_CLOUD_UPDATES; index += 1) {
      expect(await store.appendCloud(env, "full-room", `u-${index}`, null)).toBe("ok");
    }
    expect(await store.appendCloud(env, "full-room", "overflow", null)).toBe("full");
    const cloud = await store.readCloud(env, "full-room");
    expect(cloud.protected).toBe(false);
    if (!cloud.protected) expect(cloud.updates).toHaveLength(MAX_CLOUD_UPDATES);
  });
});

describe("custom paths", () => {
  it("claims a path, replaces the previous one, and rejects a path owned by another note", async () => {
    const store = new MemorySignalingStore();
    expect(await store.claimPath(env, roomId, "weekly-plan")).toBe("ok");
    expect(await store.resolvePath(env, "weekly-plan")).toBe(roomId);
    expect(await store.claimPath(env, roomId, "monday-plan")).toBe("ok");
    expect(await store.resolvePath(env, "weekly-plan")).toBeNull();
    expect(await store.resolvePath(env, "monday-plan")).toBe(roomId);
    expect(await store.claimPath(env, "other-room", "monday-plan")).toBe("taken");
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
