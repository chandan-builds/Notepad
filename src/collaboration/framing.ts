import { FRAME_CHUNK_BYTES } from "@/types/signaling";

const HEADER = 9;

export function encodeFrames(message: Uint8Array, id: number): Uint8Array[] {
  if (message.byteLength <= FRAME_CHUNK_BYTES) {
    const frame = new Uint8Array(1 + message.byteLength);
    frame[0] = 0;
    frame.set(message, 1);
    return [frame];
  }
  const total = Math.ceil(message.byteLength / FRAME_CHUNK_BYTES);
  const frames: Uint8Array[] = [];
  for (let index = 0; index < total; index += 1) {
    const start = index * FRAME_CHUNK_BYTES;
    const slice = message.subarray(start, Math.min(message.byteLength, start + FRAME_CHUNK_BYTES));
    const frame = new Uint8Array(HEADER + slice.byteLength);
    const view = new DataView(frame.buffer);
    frame[0] = 1;
    view.setUint32(1, id >>> 0);
    view.setUint16(5, index);
    view.setUint16(7, total);
    frame.set(slice, HEADER);
    frames.push(frame);
  }
  return frames;
}

type Pending = {
  id: number;
  total: number;
  parts: Array<Uint8Array | undefined>;
  got: number;
};

export class FrameReassembler {
  private pending: Pending | null = null;

  push(frame: Uint8Array): Uint8Array | null {
    if (frame.byteLength < 1) return null;
    if (frame[0] === 0) return frame.subarray(1);
    if (frame[0] !== 1 || frame.byteLength < HEADER) return null;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const id = view.getUint32(1);
    const index = view.getUint16(5);
    const total = view.getUint16(7);
    if (total === 0 || index >= total) return null;
    if (!this.pending || this.pending.id !== id || this.pending.total !== total) {
      this.pending = { id, total, parts: new Array(total), got: 0 };
    }
    if (!this.pending.parts[index]) {
      this.pending.parts[index] = frame.subarray(HEADER);
      this.pending.got += 1;
    }
    if (this.pending.got !== this.pending.total) return null;
    const size = this.pending.parts.reduce((sum, part) => sum + (part?.byteLength ?? 0), 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of this.pending.parts) {
      if (!part) return null;
      out.set(part, offset);
      offset += part.byteLength;
    }
    this.pending = null;
    return out;
  }
}
