import type { EditorView } from "@codemirror/view";

export type EditorCommand = "bold" | "italic" | "underline" | "code" | "clear";

export type FormatMark = {
  from: number;
  to: number;
  className: string;
};

type Edit = {
  text: string;
  anchor: number;
  head: number;
};

export function countWords(input: string): number {
  const normalized = stripFormatting(input).trim();
  if (!normalized) return 0;
  return normalized.split(/\s+/).length;
}

export function stripFormatting(input: string): string {
  return input
    .replace(/```/g, "")
    .replace(/<\/?u>/gi, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\*/g, "");
}

export function applyEditorCommand(text: string, anchor: number, head: number, command: EditorCommand): Edit {
  const from = Math.max(0, Math.min(anchor, head));
  const to = Math.min(text.length, Math.max(anchor, head));
  if (command === "clear") {
    const cleared = stripFormatting(text.slice(from, to));
    return replace(text, from, to, cleared, from, from + cleared.length);
  }
  if (command === "bold") return toggleWrap(text, from, to, "**", "**");
  if (command === "italic") return toggleItalic(text, from, to);
  if (command === "underline") return toggleWrap(text, from, to, "<u>", "</u>");
  if (command === "code") {
    const selected = text.slice(from, to);
    if (selected.includes("\n")) return toggleFence(text, from, to);
    return toggleWrap(text, from, to, "`", "`");
  }
  return { text, anchor, head };
}

export function applyCommand(view: EditorView, command: EditorCommand): void {
  const selection = view.state.selection.main;
  const current = view.state.doc.toString();
  const next = applyEditorCommand(current, selection.anchor, selection.head, command);
  if (next.text === current && next.anchor === selection.anchor && next.head === selection.head) {
    view.focus();
    return;
  }
  let start = 0;
  const limit = Math.min(current.length, next.text.length);
  while (start < limit && current[start] === next.text[start]) start += 1;
  let endCurrent = current.length;
  let endNext = next.text.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next.text[endNext - 1]) {
    endCurrent -= 1;
    endNext -= 1;
  }
  view.dispatch({
    changes: { from: start, to: endCurrent, insert: next.text.slice(start, endNext) },
    selection: { anchor: next.anchor, head: next.head },
  });
  view.focus();
}

export function formattingMarks(text: string): FormatMark[] {
  const occupied = new Uint8Array(text.length);
  const marks: FormatMark[] = [];

  const claim = (from: number, to: number, className: string) => {
    if (to <= from || from < 0 || to > text.length) return;
    for (let index = from; index < to; index += 1) {
      if (occupied[index]) return;
    }
    for (let index = from; index < to; index += 1) occupied[index] = 1;
    marks.push({ from, to, className });
  };

  const fence = /```[^\n]*\n[\s\S]*?```/g;
  for (const match of text.matchAll(fence)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const openEnd = match[0].indexOf("\n") + 1;
    const closeStart = match[0].lastIndexOf("```");
    claim(from, from + openEnd, "cm-fmt-marker");
    claim(from + openEnd, from + closeStart, "cm-fmt-code");
    claim(from + closeStart, to, "cm-fmt-marker");
  }

  const underline = /<u>[\s\S]*?<\/u>/gi;
  for (const match of text.matchAll(underline)) {
    const from = match.index ?? 0;
    const bodyFrom = from + 3;
    const bodyTo = from + match[0].length - 4;
    claim(from, bodyFrom, "cm-fmt-marker");
    claim(bodyFrom, bodyTo, "cm-fmt-underline");
    claim(bodyTo, from + match[0].length, "cm-fmt-marker");
  }

  const bold = /\*\*[^*]+\*\*/g;
  for (const match of text.matchAll(bold)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    claim(from, from + 2, "cm-fmt-marker");
    claim(from + 2, to - 2, "cm-fmt-bold");
    claim(to - 2, to, "cm-fmt-marker");
  }

  const code = /`[^`\n]+`/g;
  for (const match of text.matchAll(code)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    claim(from, from + 1, "cm-fmt-marker");
    claim(from + 1, to - 1, "cm-fmt-code");
    claim(to - 1, to, "cm-fmt-marker");
  }

  const italic = /(^|[^*])\*([^*\n]+)\*(?!\*)/g;
  for (const match of text.matchAll(italic)) {
    const full = match.index ?? 0;
    const from = full + match[1].length;
    const to = from + match[2].length + 2;
    claim(from, from + 1, "cm-fmt-marker");
    claim(from + 1, to - 1, "cm-fmt-italic");
    claim(to - 1, to, "cm-fmt-marker");
  }

  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  return marks;
}

function toggleWrap(text: string, from: number, to: number, open: string, close: string): Edit {
  const before = text.slice(Math.max(0, from - open.length), from);
  const after = text.slice(to, to + close.length);
  if (before === open && after === close) {
    const next = text.slice(0, from - open.length) + text.slice(from, to) + text.slice(to + close.length);
    const anchor = from - open.length;
    return { text: next, anchor, head: anchor + (to - from) };
  }
  const selected = text.slice(from, to);
  if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return replace(text, from, to, inner, from, from + inner.length);
  }
  const insert = `${open}${selected}${close}`;
  return replace(text, from, to, insert, from + open.length, from + open.length + selected.length);
}

function toggleItalic(text: string, from: number, to: number): Edit {
  const before = text.slice(Math.max(0, from - 2), from);
  const after = text.slice(to, to + 2);
  if (before.endsWith("*") && !before.endsWith("**") && after.startsWith("*") && !after.startsWith("**")) {
    const next = text.slice(0, from - 1) + text.slice(from, to) + text.slice(to + 1);
    return { text: next, anchor: from - 1, head: to - 1 };
  }
  const selected = text.slice(from, to);
  if (
    selected.startsWith("*") &&
    selected.endsWith("*") &&
    !selected.startsWith("**") &&
    !selected.endsWith("**") &&
    selected.length >= 2
  ) {
    const inner = selected.slice(1, -1);
    return replace(text, from, to, inner, from, from + inner.length);
  }
  return replace(text, from, to, `*${selected}*`, from + 1, from + 1 + selected.length);
}

function toggleFence(text: string, from: number, to: number): Edit {
  const selected = text.slice(from, to);
  if (selected.startsWith("```\n") && selected.endsWith("\n```")) {
    const inner = selected.slice(4, -4);
    return replace(text, from, to, inner, from, from + inner.length);
  }
  const insert = `\`\`\`\n${selected}\n\`\`\``;
  return replace(text, from, to, insert, from + 4, from + 4 + selected.length);
}

function replace(text: string, from: number, to: number, insert: string, anchor: number, head: number): Edit {
  return {
    text: text.slice(0, from) + insert + text.slice(to),
    anchor,
    head,
  };
}
