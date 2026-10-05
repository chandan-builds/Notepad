import * as Y from "yjs";
import { countWords, stripFormatting } from "@/editor/format";

export const MAX_NOTE_TABS = 20;
export const TAB_TITLE_MAX = 40;
export const TITLE_MAX = 80;

export type NoteTabView = {
  id: string;
  label: string;
  title: string;
  text: string;
};

export type NoteView = {
  title: string;
  slug: string;
  tabs: NoteTabView[];
  activeTabId: string;
  activeText: string;
  wordCount: number;
  canAddTab: boolean;
  ytext: Y.Text | null;
};

const EMPTY_NOTE: NoteView = {
  title: "Untitled Note",
  slug: "",
  tabs: [],
  activeTabId: "",
  activeText: "",
  wordCount: 0,
  canAddTab: true,
  ytext: null,
};

export function ensureNote(doc: Y.Doc): void {
  const order = doc.getArray<string>("tabOrder");
  if (order.length > 0) return;
  doc.transact(() => {
    if (order.length > 0) return;
    const id = "note";
    const tab = new Y.Map<unknown>();
    const text = new Y.Text();
    const legacy = doc.getText("body").toString();
    if (legacy) text.insert(0, legacy);
    tab.set("title", "");
    tab.set("text", text);
    doc.getMap("tabs").set(id, tab);
    order.push([id]);
    const meta = doc.getMap("meta");
    if (typeof meta.get("title") !== "string") meta.set("title", "Untitled Note");
    if (typeof meta.get("activeTabId") !== "string") meta.set("activeTabId", id);
  });
}

export function readNote(doc: Y.Doc): NoteView {
  ensureNote(doc);
  const ids = tabIds(doc);
  const tabs = ids.map((id, index) => {
    const tab = readTab(doc, id);
    const title = tab?.title ?? "";
    const text = tab?.text ?? "";
    return { id, title, text, label: tabLabel(title, text, index) };
  });
  const meta = doc.getMap("meta");
  const requested = meta.get("activeTabId");
  const activeTabId = typeof requested === "string" && ids.includes(requested) ? requested : (ids[0] ?? "");
  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const title = typeof meta.get("title") === "string" ? String(meta.get("title")) : "Untitled Note";
  const slug = typeof meta.get("slug") === "string" ? String(meta.get("slug")) : "";
  return {
    title,
    slug,
    tabs,
    activeTabId,
    activeText: active?.text ?? "",
    wordCount: countWords(active?.text ?? ""),
    canAddTab: ids.length < MAX_NOTE_TABS,
    ytext: activeTabId ? (readTab(doc, activeTabId)?.ytext ?? null) : null,
  };
}

export function setNoteTitle(doc: Y.Doc, value: string): void {
  ensureNote(doc);
  doc.getMap("meta").set("title", limit(value, TITLE_MAX));
}

export function setNoteSlug(doc: Y.Doc, slug: string): void {
  ensureNote(doc);
  doc.getMap("meta").set("slug", slug);
}

export function selectNoteTab(doc: Y.Doc, tabId: string): void {
  const ids = tabIds(doc);
  if (!ids.includes(tabId) || doc.getMap("meta").get("activeTabId") === tabId) return;
  doc.getMap("meta").set("activeTabId", tabId);
}

export function addNoteTab(doc: Y.Doc): void {
  ensureNote(doc);
  const order = doc.getArray<string>("tabOrder");
  if (tabIds(doc).length >= MAX_NOTE_TABS) return;
  const id = createTabId();
  doc.transact(() => {
    const tab = new Y.Map<unknown>();
    tab.set("title", "");
    tab.set("text", new Y.Text());
    doc.getMap("tabs").set(id, tab);
    order.push([id]);
    doc.getMap("meta").set("activeTabId", id);
  });
}

export function closeNoteTab(doc: Y.Doc, tabId: string): void {
  const ids = tabIds(doc);
  if (ids.length <= 1 || !ids.includes(tabId)) return;
  const nextActive = neighborAfterClose(ids, tabId, doc.getMap("meta").get("activeTabId"));
  doc.transact(() => {
    const order = doc.getArray<string>("tabOrder");
    const current = order.toArray();
    const position = current.indexOf(tabId);
    if (position >= 0) order.delete(position, 1);
    doc.getMap("tabs").delete(tabId);
    if (nextActive) doc.getMap("meta").set("activeTabId", nextActive);
  });
}

export function renameNoteTab(doc: Y.Doc, tabId: string, title: string): void {
  const tab = tabMap(doc, tabId);
  if (!tab) return;
  const next = limit(title.trim(), TAB_TITLE_MAX);
  if (tab.get("title") === next) return;
  tab.set("title", next);
}

export function reorderNoteTabs(doc: Y.Doc, fromId: string, toId: string): void {
  if (fromId === toId) return;
  const ids = tabIds(doc);
  const fromIndex = ids.indexOf(fromId);
  const toIndex = ids.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return;
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  const order = doc.getArray<string>("tabOrder");
  doc.transact(() => {
    order.delete(0, order.length);
    order.insert(0, next);
  });
}

export function emptyNoteView(): NoteView {
  return EMPTY_NOTE;
}

function tabIds(doc: Y.Doc): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of doc.getArray<string>("tabOrder").toArray()) {
    if (typeof id !== "string" || seen.has(id) || !readTab(doc, id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_NOTE_TABS) break;
  }
  return ids;
}

function readTab(doc: Y.Doc, id: string): { title: string; text: string; ytext: Y.Text } | null {
  const tab = tabMap(doc, id);
  if (!tab) return null;
  const text = tab.get("text");
  if (!(text instanceof Y.Text)) return null;
  const title = tab.get("title");
  return { title: typeof title === "string" ? title : "", text: text.toString(), ytext: text };
}

function tabMap(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const value = doc.getMap("tabs").get(id);
  return value instanceof Y.Map ? value : null;
}

function tabLabel(title: string, text: string, index: number): string {
  const custom = title.trim();
  if (custom) return custom;
  const first = stripFormatting(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!first) return `Tab ${index + 1}`;
  return limit(first, TAB_TITLE_MAX);
}

function limit(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function neighborAfterClose(ids: string[], tabId: string, activeId: unknown): string | null {
  if (activeId !== tabId) return null;
  const index = ids.indexOf(tabId);
  const remaining = ids.filter((id) => id !== tabId);
  return remaining[Math.min(index, remaining.length - 1)] ?? null;
}
