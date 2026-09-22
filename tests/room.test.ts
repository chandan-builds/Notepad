import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  createNoteAddress,
  isValidRoomId,
  noteCodePath,
  notePath,
  parseFragmentKey,
  parseShareCode,
  randomSecret,
} from "@/lib/room";

describe("room secrets", () => {
  it("creates a 22-character room id and fragment", () => {
    const { roomId, key } = createNoteAddress();
    expect(isValidRoomId(roomId)).toBe(true);
    expect(parseFragmentKey(`#${key}`)).toBe(key);
    expect(base64UrlToBytes(roomId)?.byteLength).toBe(16);
    expect(notePath(roomId, key)).toBe(`/n/${roomId}#${key}`);
    expect(noteCodePath(roomId)).toBe(`/n/${roomId}`);
  });

  it("reads a share code from the code itself or from a note link", () => {
    const roomId = randomSecret();
    expect(parseShareCode(roomId)).toBe(roomId);
    expect(parseShareCode(`  ${roomId}  `)).toBe(roomId);
    expect(parseShareCode(`https://notepad.example/n/${roomId}`)).toBe(roomId);
    expect(parseShareCode(`https://notepad.example/n/${roomId}#old`)).toBe(roomId);
    expect(parseShareCode(`/n/${roomId}`)).toBe(roomId);
    expect(parseShareCode("not a code")).toBeNull();
    expect(parseShareCode("")).toBeNull();
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
