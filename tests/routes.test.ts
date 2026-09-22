import { afterEach, describe, expect, it } from "vitest";
import { resetSignalingStoreForTests, signalingEnvironment } from "@/signaling/get-store";
import { getPeers, getSignal, postPresence, postSignal } from "@/signaling/handlers";
import { randomSecret } from "@/lib/room";
import { MAX_SIGNAL_BODY_CHARS } from "@/types/signaling";

const peerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const peerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

afterEach(() => {
  resetSignalingStoreForTests();
});

describe("signaling routes", () => {
  it("rejects a bad room, a bad peer, and an oversized body", async () => {
    const roomId = randomSecret();
    const badRoom = await postPresence(jsonRequest({ peerId: peerA }), "not-a-room");
    expect(badRoom.status).toBe(400);

    const badPeer = await postPresence(jsonRequest({ peerId: "nope" }), roomId);
    expect(badPeer.status).toBe(400);

    const huge = await postSignal(
      jsonRequest({ to: peerA, from: peerB, id: peerA, body: "x".repeat(MAX_SIGNAL_BODY_CHARS + 1) }),
      roomId,
    );
    expect(huge.status).toBe(413);
  });

  it("heartbeats, lists other peers, and drains only the addressed mailbox", async () => {
    const roomId = randomSecret();
    const presence = await postPresence(jsonRequest({ peerId: peerA }), roomId);
    expect(presence.status).toBe(200);
    expect(presence.headers.get("cache-control")).toBe("no-store");

    await postPresence(jsonRequest({ peerId: peerB }), roomId);
    const peers = await getPeers(new Request(`http://local/peers?peerId=${peerA}`), roomId);
    const listed = (await peers.json()) as { peers: string[]; roster: Array<{ id: string }> };
    expect(listed.peers).toEqual([peerB]);
    expect(listed.roster.map((entry) => entry.id).sort()).toEqual([peerA, peerB].sort());

    const posted = await postSignal(
      jsonRequest({ to: peerB, from: peerA, id: peerA, body: "ciphertext" }),
      roomId,
    );
    expect(posted.status).toBe(200);

    const own = await getSignal(new Request(`http://local/signal?peerId=${peerA}`), roomId);
    expect(await own.json()).toEqual({ messages: [] });

    const theirs = await getSignal(new Request(`http://local/signal?peerId=${peerB}`), roomId);
    expect(await theirs.json()).toEqual({
      messages: [{ to: peerB, from: peerA, id: peerA, body: "ciphertext" }],
    });
    expect(signalingEnvironment()).toBeTruthy();
  });

  it("returns 503 in production when Redis is unset", async () => {
    const previous = process.env.NODE_ENV;
    setNodeEnv("production");
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetSignalingStoreForTests();
    try {
      const response = await postPresence(jsonRequest({ peerId: peerA }), randomSecret());
      expect(response.status).toBe(503);
    } finally {
      setNodeEnv(previous);
      resetSignalingStoreForTests();
    }
  });
});

function setNodeEnv(value: string | undefined): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function jsonRequest(body: unknown): Request {
  return new Request("http://local/signaling", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
