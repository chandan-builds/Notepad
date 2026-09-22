import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  createNoteAddress,
  isValidRoomId,
  notePath,
  parseFragmentKey,
  randomSecret,
} from "@/lib/room";

describe("room secrets", () => {
  it("creates a 22-character room id and fragment", () => {
    const { roomId, key } = createNoteAddress();
    expect(isValidRoomId(roomId)).toBe(true);
    expect(parseFragmentKey(`#${key}`)).toBe(key);
    expect(base64UrlToBytes(roomId)?.byteLength).toBe(16);
    expect(notePath(roomId, key)).toBe(`/n/${roomId}#${key}`);
  });

  it("rejects a missing hash, the wrong length, padding, and a query stuck in the id", () => {
    const key = randomSecret();
    expect(parseFragmentKey("")).toBeNull();
    expect(parseFragmentKey("#")).toBeNull();
    expect(parseFragmentKey(`#${key.slice(0, 21)}`)).toBeNull();
    expect(parseFragmentKey(`#${key}=`)).toBeNull();
    expect(parseFragmentKey(`#${key}==`)).toBeNull();
    expect(isValidRoomId(`${key}?x=1`)).toBe(false);
    expect(parseFragmentKey(`#${key}?x=1`)).toBeNull();
    expect(isValidRoomId(`${key.slice(0, 21)}+`)).toBe(false);
  });
});
