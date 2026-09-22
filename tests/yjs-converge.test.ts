import { describe, expect, it } from "vitest";
import * as Y from "yjs";

function text(doc: Y.Doc): string {
  return doc.getText("body").toString();
}

function clone(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

function exchange(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe("yjs convergence", () => {
  it("exchanges sequential edits, reversed delivery, and duplicates", () => {
    const a = new Y.Doc();
    a.getText("body").insert(0, "Hello");
    const update = Y.encodeStateAsUpdate(a);

    const forward = new Y.Doc();
    Y.applyUpdate(forward, update);
    expect(text(forward)).toBe("Hello");

    const reverse = new Y.Doc();
    const second = new Y.Doc();
    second.getText("body").insert(0, "World");
    const secondUpdate = Y.encodeStateAsUpdate(second);
    Y.applyUpdate(reverse, secondUpdate);
    Y.applyUpdate(reverse, update);
    Y.applyUpdate(reverse, update);
    expect(text(reverse)).toContain("Hello");
    expect(text(reverse)).toContain("World");

    const again = clone(forward);
    Y.applyUpdate(again, update);
    expect(text(again)).toBe("Hello");
  });

  it("keeps both characters when two peers insert at the same index", () => {
    const base = new Y.Doc();
    base.getText("body").insert(0, "Hi");
    const a = clone(base);
    const b = clone(base);
    const aUpdates: Uint8Array[] = [];
    const bUpdates: Uint8Array[] = [];
    a.on("update", (update) => aUpdates.push(update));
    b.on("update", (update) => bUpdates.push(update));
    a.getText("body").insert(2, "A");
    b.getText("body").insert(2, "B");

    const left = clone(a);
    const right = clone(b);
    for (const update of bUpdates) Y.applyUpdate(left, update);
    for (const update of aUpdates) Y.applyUpdate(right, update);
    for (const update of [...aUpdates].reverse()) Y.applyUpdate(clone(b), update);

    expect(text(left)).toBe(text(right));
    expect(text(left)).toContain("A");
    expect(text(left)).toContain("B");
    expect(text(left).startsWith("Hi")).toBe(true);
  });

  it("merges offline inserts made on both sides", () => {
    const base = new Y.Doc();
    base.getText("body").insert(0, "Note");
    const a = clone(base);
    const b = clone(base);
    a.getText("body").insert(4, " from A");
    b.getText("body").insert(4, " from B");
    exchange(a, b);
    expect(text(a)).toBe(text(b));
    expect(text(a)).toContain("from A");
    expect(text(a)).toContain("from B");
  });
});
