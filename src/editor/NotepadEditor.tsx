"use client";

import { useEffect, useRef } from "react";
import { defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, placeholder } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

type NotepadEditorProps = {
  doc: Y.Doc;
  awareness: Awareness;
};

export function NotepadEditor({ doc, awareness }: NotepadEditorProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const ytext = doc.getText("body");
    const undoManager = new Y.UndoManager(ytext);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          placeholder("Start typing…"),
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
          editorTheme,
          EditorView.contentAttributes.of({ "aria-label": "Shared note" }),
          yCollab(ytext, awareness, { undoManager }),
        ],
      }),
    });
    view.focus();
    return () => {
      view.destroy();
      undoManager.destroy();
    };
  }, [doc, awareness]);

  return <div className="editor-host" ref={host} />;
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--ink)",
    fontSize: "17px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    lineHeight: "1.75",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "0.35rem 1.4rem 2.5rem 3.4rem",
    caretColor: "var(--rule)",
  },
  ".cm-line": {
    padding: "0 0.15rem",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--rule)",
    borderLeftWidth: "2px",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(196, 73, 44, 0.06)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(196, 73, 44, 0.16)",
  },
  ".cm-placeholder": {
    color: "var(--faint)",
    fontStyle: "italic",
    fontFamily: "var(--font-text), serif",
  },
  ".cm-ySelectionInfo": {
    opacity: "1",
    fontFamily: "var(--font-text), serif",
    borderRadius: "2px",
    padding: "0 4px",
  },
});
