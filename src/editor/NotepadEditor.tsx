"use client";

import { useEffect, useRef } from "react";
import { defaultKeymap } from "@codemirror/commands";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, highlightActiveLine, keymap, placeholder, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { applyCommand, formattingMarks, type EditorCommand } from "@/editor/format";
import type { EditorScrollState } from "@/hooks/useCanvasPip";

type NotepadEditorProps = {
  text: Y.Text;
  awareness: Awareness;
  onScroll: (state: EditorScrollState) => void;
  onCommand: (apply: (command: EditorCommand) => void) => void;
};

export function NotepadEditor({ text, awareness, onScroll, onCommand }: NotepadEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const onScrollRef = useRef(onScroll);
  const onCommandRef = useRef(onCommand);
  onScrollRef.current = onScroll;
  onCommandRef.current = onCommand;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const undoManager = new Y.UndoManager(text);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          placeholder("Start typing…"),
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
          formattingPlugin,
          editorTheme,
          EditorView.contentAttributes.of({ "aria-label": "Note" }),
          yCollab(text, awareness, { undoManager }),
        ],
      }),
    });
    const report = () => {
      const scroller = view.scrollDOM;
      onScrollRef.current({
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      });
    };
    view.scrollDOM.addEventListener("scroll", report);
    report();
    onCommandRef.current((command) => applyCommand(view, command));
    view.focus();
    return () => {
      view.scrollDOM.removeEventListener("scroll", report);
      view.destroy();
      undoManager.destroy();
    };
  }, [awareness, text]);

  return <div className="editor-host" ref={host} />;
}

const formattingPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorationsFor(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = decorationsFor(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function decorationsFor(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const mark of formattingMarks(view.state.doc.toString())) {
    builder.add(mark.from, mark.to, Decoration.mark({ class: mark.className }));
  }
  return builder.finish();
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
    fontFamily: "var(--font-text), serif",
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
  },
  ".cm-ySelectionInfo": {
    opacity: "1",
    fontFamily: "var(--font-text), serif",
    borderRadius: "2px",
    padding: "0 4px",
  },
  ".cm-fmt-bold": {
    fontWeight: "700",
  },
  ".cm-fmt-italic": {
    fontStyle: "italic",
  },
  ".cm-fmt-underline": {
    textDecoration: "underline",
  },
  ".cm-fmt-code": {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    backgroundColor: "rgba(196, 73, 44, 0.08)",
    borderRadius: "3px",
  },
  ".cm-fmt-marker": {
    color: "var(--faint)",
    fontSize: "0.82em",
  },
});
