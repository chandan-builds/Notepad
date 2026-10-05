import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addNoteTab,
  closeNoteTab,
  MAX_NOTE_TABS,
  readNote,
  renameNoteTab,
  reorderNoteTabs,
  selectNoteTab,
  setNoteTitle,
} from "@/editor/note-model";

function exchange(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe("note tabs", () => {
  it("migrates the legacy body into the first tab", () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "Hello from before");
    const note = readNote(doc);
    expect(note.title).toBe("Untitled Note");
    expect(note.tabs).toHaveLength(1);
    expect(note.activeText).toBe("Hello from before");
    expect(note.wordCount).toBe(3);
  });

  it("adds, renames, reorders, selects, and closes tabs", () => {
    const doc = new Y.Doc();
    readNote(doc);
    addNoteTab(doc);
    const first = readNote(doc);
    expect(first.tabs).toHaveLength(2);
    const [original, added] = first.tabs;
    renameNoteTab(doc, added.id, "Scratch");
    reorderNoteTabs(doc, added.id, original.id);
    selectNoteTab(doc, original.id);
    const renamed = readNote(doc);
    expect(renamed.tabs.map((tab) => tab.label)).toEqual(["Scratch", "Tab 2"]);
    expect(renamed.activeTabId).toBe(original.id);
    closeNoteTab(doc, original.id);
    const closed = readNote(doc);
    expect(closed.tabs).toHaveLength(1);
    expect(closed.activeTabId).toBe(added.id);
    closeNoteTab(doc, added.id);
    expect(readNote(doc).tabs).toHaveLength(1);
  });

  it("stops at the tab limit and keeps titles short", () => {
    const doc = new Y.Doc();
    readNote(doc);
    for (let index = 0; index < MAX_NOTE_TABS + 3; index += 1) addNoteTab(doc);
    expect(readNote(doc).tabs).toHaveLength(MAX_NOTE_TABS);
    expect(readNote(doc).canAddTab).toBe(false);
    setNoteTitle(doc, "x".repeat(120));
    expect(readNote(doc).title).toHaveLength(80);
  });

  it("converges tab text between two documents", () => {
    const a = new Y.Doc();
    readNote(a);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const aText = readNote(a).ytext;
    const bText = readNote(b).ytext;
    aText?.insert(0, "Alpha");
    bText?.insert(0, "Beta");
    exchange(a, b);
    expect(readNote(a).activeText).toBe(readNote(b).activeText);
    expect(readNote(a).activeText).toContain("Alpha");
    expect(readNote(a).activeText).toContain("Beta");
  });
});
