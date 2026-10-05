import { afterEach, describe, expect, it } from "vitest";
import { getCloud, postCloud } from "@/cloud/handlers";
import { claimNotePath, resolveNotePath } from "@/lib/note-path";
import { decryptBytes, derivePasswordKeys, encryptBytes, randomSalt } from "@/cloud/password";
import { resetSignalingStoreForTests, signalingEnvironment } from "@/signaling/get-store";
import { getPeers, getSignal, postPresence, postSignal } from "@/signaling/handlers";
import { bytesToBase64 } from "@/lib/bytes";
import { randomSecret } from "@/lib/room";
import { MAX_SIGNAL_BODY_CHARS } from "@/types/signaling";
import * as Y from "yjs";

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

describe("cloud routes", () => {
  it("stores a note, then hides it until the password matches", async () => {
    const roomId = randomSecret();
    const created = await getCloud(roomId);
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const open = (await created.json()) as { protected: boolean; updates: string[] };
    expect(open.protected).toBe(false);
    expect(open.updates).toEqual([]);

    const doc = new Y.Doc();
    doc.getText("body").insert(0, "secret");
    const salt = randomSalt();
    const derived = await derivePasswordKeys("correct horse", salt);
    const snapshot = await encryptBytes(derived.key, Y.encodeStateAsUpdate(doc));
    const locked = await postCloud(
      jsonRequest({ action: "protect", salt: bytesToBase64(salt), verifier: derived.verifier, snapshot }),
      roomId,
    );
    expect(locked.status).toBe(200);

    const hidden = await getCloud(roomId);
    const body = (await hidden.json()) as { protected: boolean; salt: string; updates?: string[] };
    expect(body).toEqual({ protected: true, salt: bytesToBase64(salt) });
    expect(JSON.stringify(body)).not.toContain("secret");

    const wrong = await postCloud(jsonRequest({ action: "unlock", verifier: `${"a".repeat(43)}=` }), roomId);
    expect(wrong.status).toBe(401);

    const denied = await postCloud(jsonRequest({ action: "append", update: "plaintext" }), roomId);
    expect(denied.status).toBe(401);

    const opened = await postCloud(jsonRequest({ action: "unlock", verifier: derived.verifier }), roomId);
    expect(opened.status).toBe(200);
    const unlocked = (await opened.json()) as { updates: string[] };
    const bytes = await decryptBytes(derived.key, unlocked.updates[0]);
    const next = new Y.Doc();
    Y.applyUpdate(next, bytes!);
    expect(next.getText("body").toString()).toBe("secret");
  });

  it("claims a custom path and refuses a second note that wants it", async () => {
    const roomId = randomSecret();
    const other = randomSecret();
    const claimed = await claimNotePath(jsonRequest({ slug: "Team Notes" }), roomId);
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ slug: "team-notes" });
    expect(await resolveNotePath("team-notes")).toBe(roomId);

    const taken = await claimNotePath(jsonRequest({ slug: "team-notes" }), other);
    expect(taken.status).toBe(409);
    expect(await resolveNotePath("team-notes")).toBe(roomId);

    const reserved = await claimNotePath(jsonRequest({ slug: "abcdefghijklmnopqrstuv" }), roomId);
    expect(reserved.status).toBe(400);
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
