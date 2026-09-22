import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { SyncChannel, type ByteChannel } from "@/collaboration/sync-channel";

class FakeChannel implements ByteChannel {
  readyState: RTCDataChannelState = "connecting";
  binaryType: BinaryType = "arraybuffer";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  onopen: ByteChannel["onopen"] = null;
  onclose: ByteChannel["onclose"] = null;
  onmessage: ByteChannel["onmessage"] = null;
  onbufferedamountlow: ByteChannel["onbufferedamountlow"] = null;
  peer: FakeChannel | null = null;

  send(data: ArrayBuffer): void {
    const peer = this.peer;
    queueMicrotask(() => {
      peer?.onmessage?.call(peer as unknown as RTCDataChannel, { data } as MessageEvent);
    });
  }

  close(): void {
    this.readyState = "closed";
  }

  open(): void {
    this.readyState = "open";
    this.onopen?.call(this as unknown as RTCDataChannel, new Event("open"));
  }
}

describe("sync channel", () => {
  it("merges concurrent inserts across a pair of channels", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const awarenessA = new Awareness(docA);
    const awarenessB = new Awareness(docB);
    awarenessA.setLocalStateField("user", { name: "A", color: "#c4492c", colorLight: "#c4492c33" });
    awarenessB.setLocalStateField("user", { name: "B", color: "#1f6b4a", colorLight: "#1f6b4a33" });
    const left = new FakeChannel();
    const right = new FakeChannel();
    left.peer = right;
    right.peer = left;
    const syncA = new SyncChannel(docA, awarenessA, left);
    const syncB = new SyncChannel(docB, awarenessB, right);

    docA.getText("body").insert(0, "Hello");
    docB.getText("body").insert(0, "World");
    left.open();
    right.open();

    await waitFor(
      () =>
        docA.getText("body").toString() === docB.getText("body").toString() &&
        docA.getText("body").toString().includes("Hello") &&
        docA.getText("body").toString().includes("World"),
    );

    docA.getText("body").insert(docA.getText("body").length, "!");
    await waitFor(() => docB.getText("body").toString().endsWith("!"));
    expect(docA.getText("body").toString()).toBe(docB.getText("body").toString());

    syncA.destroy();
    syncB.destroy();
    awarenessA.destroy();
    awarenessB.destroy();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out waiting for sync");
}
