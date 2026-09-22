import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { encodeFrames, FrameReassembler } from "@/collaboration/framing";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;
const BUFFER_HIGH = 64 * 1024;
const MAX_QUEUE = 32;

export interface ByteChannel {
  readyState: RTCDataChannelState;
  binaryType: BinaryType;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  onopen: ((this: RTCDataChannel, ev: Event) => void) | null;
  onclose: ((this: RTCDataChannel, ev: Event) => void) | null;
  onmessage: ((this: RTCDataChannel, ev: MessageEvent) => void) | null;
  onbufferedamountlow: ((this: RTCDataChannel, ev: Event) => void) | null;
  send(data: ArrayBuffer): void;
  close(): void;
}

type AwarenessUpdate = {
  added: number[];
  updated: number[];
  removed: number[];
};

export class SyncChannel {
  private readonly reassembler = new FrameReassembler();
  private readonly queue: Uint8Array[] = [];
  private dropped = false;
  private frameId = 1;
  private readonly onDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private readonly onAwareness: (update: AwarenessUpdate, origin: unknown) => void;

  constructor(
    private readonly doc: Y.Doc,
    private readonly awareness: awarenessProtocol.Awareness,
    private readonly channel: ByteChannel,
  ) {
    this.onDocUpdate = (update, origin) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.send(encoding.toUint8Array(encoder));
    };
    this.onAwareness = ({ added, updated, removed }, origin) => {
      if (origin === this) return;
      const clients = added.concat(updated, removed);
      if (clients.length === 0) return;
      this.sendAwareness(clients);
    };
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwareness);
    this.channel.binaryType = "arraybuffer";
    this.channel.bufferedAmountLowThreshold = 16 * 1024;
    this.channel.onmessage = (event) => this.onMessage(event.data);
    this.channel.onbufferedamountlow = () => this.flush();
    this.channel.onopen = () => this.handleOpen();
    if (this.channel.readyState === "open") this.handleOpen();
  }

  destroy(): void {
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwareness);
    this.queue.length = 0;
  }

  private handleOpen(): void {
    this.sendSyncStep1();
    this.sendAwarenessQuery();
    const local = this.awareness.getLocalState();
    if (local) this.sendAwareness([this.doc.clientID]);
  }

  private onMessage(data: unknown): void {
    const bytes = toBytes(data);
    if (!bytes) return;
    const message = this.reassembler.push(bytes);
    if (!message) return;
    const decoder = decoding.createDecoder(message);
    const encoder = encoding.createEncoder();
    let type = 0;
    try {
      type = decoding.readVarUint(decoder);
    } catch {
      return;
    }
    if (type === MESSAGE_SYNC) {
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      try {
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      } catch {
        return;
      }
      if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
      return;
    }
    if (type === MESSAGE_AWARENESS) {
      try {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this,
        );
      } catch {
        /* ignore a bad awareness frame */
      }
      return;
    }
    if (type === MESSAGE_QUERY_AWARENESS) {
      this.sendAwareness(Array.from(this.awareness.getStates().keys()));
    }
  }

  private sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  private sendFullState(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(this.doc));
    this.writeNow(encoding.toUint8Array(encoder));
  }

  private sendAwareness(clients: number[]): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients),
    );
    this.send(encoding.toUint8Array(encoder));
  }

  private sendAwarenessQuery(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    this.send(encoding.toUint8Array(encoder));
  }

  private send(message: Uint8Array): void {
    if (this.channel.readyState !== "open") return;
    if (this.dropped || this.channel.bufferedAmount > BUFFER_HIGH || this.queue.length > 0) {
      this.queue.push(message);
      if (this.queue.length > MAX_QUEUE) {
        this.queue.length = 0;
        this.dropped = true;
      }
      return;
    }
    this.writeNow(message);
  }

  private flush(): void {
    if (this.channel.readyState !== "open") return;
    if (this.dropped && this.channel.bufferedAmount === 0) {
      this.dropped = false;
      this.sendSyncStep1();
      this.sendFullState();
      return;
    }
    while (this.queue.length > 0 && this.channel.bufferedAmount <= BUFFER_HIGH) {
      const next = this.queue.shift();
      if (next) this.writeNow(next);
    }
  }

  private writeNow(message: Uint8Array): void {
    if (this.channel.readyState !== "open") return;
    for (const frame of encodeFrames(message, this.frameId++)) {
      this.channel.send(copyBuffer(frame));
    }
  }
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}
