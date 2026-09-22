import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "@/lib/bytes";
import { createNoteAddress } from "@/lib/room";
import { decryptBody, deriveSignalingKey, encryptBody } from "@/signaling/crypto";

describe("signaling crypto", () => {
  it("round-trips, rejects a flipped byte, and rejects the wrong key", async () => {
    const { roomId, key } = createNoteAddress();
    const other = createNoteAddress();
    const cryptoKey = await deriveSignalingKey(key, roomId);
    const wrongKey = await deriveSignalingKey(other.key, roomId);
    const body = await encryptBody(cryptoKey, "offer-not-the-note");

    expect(await decryptBody(cryptoKey, body)).toBe("offer-not-the-note");
    expect(await decryptBody(wrongKey, body)).toBeNull();

    const bytes = base64ToBytes(body);
    expect(bytes).not.toBeNull();
    const flipped = new Uint8Array(bytes!);
    flipped[flipped.length - 1] ^= 0xff;
    expect(await decryptBody(cryptoKey, bytesToBase64(flipped))).toBeNull();
  });
});
