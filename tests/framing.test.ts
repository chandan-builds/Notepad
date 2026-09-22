import { describe, expect, it } from "vitest";
import { encodeFrames, FrameReassembler } from "@/collaboration/framing";
import { FRAME_CHUNK_BYTES } from "@/types/signaling";

describe("framing", () => {
  it("round-trips a small frame and a multi-chunk frame", () => {
    const small = new Uint8Array([1, 2, 3, 4]);
    const smallOut = new FrameReassembler();
    expect(smallOut.push(encodeFrames(small, 1)[0]!)).toEqual(small);

    const large = new Uint8Array(FRAME_CHUNK_BYTES * 2 + 20);
    for (let index = 0; index < large.length; index += 1) large[index] = index % 251;
    const frames = encodeFrames(large, 7);
    expect(frames.length).toBe(3);
    const reassembler = new FrameReassembler();
    expect(reassembler.push(frames[0]!)).toBeNull();
    expect(reassembler.push(frames[1]!)).toBeNull();
    expect(reassembler.push(frames[2]!)).toEqual(large);
  });
});
