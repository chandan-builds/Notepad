"use client";

import { useEffect, useState } from "react";
import type * as Y from "yjs";
import {
  addNoteTab,
  closeNoteTab,
  emptyNoteView,
  ensureNote,
  readNote,
  renameNoteTab,
  reorderNoteTabs,
  selectNoteTab,
  setNoteSlug,
  setNoteTitle,
  type NoteView,
} from "@/editor/note-model";

export function useNoteModel(doc: Y.Doc | null): NoteView & {
  setTitle: (value: string) => void;
  setSlug: (value: string) => void;
  selectTab: (tabId: string) => void;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
  reorderTabs: (fromId: string, toId: string) => void;
} {
  const [view, setView] = useState<NoteView>(emptyNoteView);

  useEffect(() => {
    if (!doc) {
      setView(emptyNoteView());
      return;
    }
    ensureNote(doc);
    const pull = () => setView(readNote(doc));
    pull();
    doc.on("update", pull);
    return () => {
      doc.off("update", pull);
    };
  }, [doc]);

  return {
    ...view,
    setTitle: (value) => {
      if (doc) setNoteTitle(doc, value);
    },
    setSlug: (value) => {
      if (doc) setNoteSlug(doc, value);
    },
    selectTab: (tabId) => {
      if (doc) selectNoteTab(doc, tabId);
    },
    addTab: () => {
      if (doc) addNoteTab(doc);
    },
    closeTab: (tabId) => {
      if (doc) closeNoteTab(doc, tabId);
    },
    renameTab: (tabId, title) => {
      if (doc) renameNoteTab(doc, tabId, title);
    },
    reorderTabs: (fromId, toId) => {
      if (doc) reorderNoteTabs(doc, fromId, toId);
    },
  };
}
