"use client";

import type { EditorCommand } from "@/editor/format";

const TOOLBAR_ITEMS: Array<{ label: string; icon: string; command: EditorCommand }> = [
  { label: "Bold", icon: "B", command: "bold" },
  { label: "Italic", icon: "I", command: "italic" },
  { label: "Underline", icon: "U", command: "underline" },
  { label: "Code", icon: "<>", command: "code" },
  { label: "Clear formatting", icon: "Clear", command: "clear" },
];

export function EditorToolbar({ onCommand }: { onCommand: (command: EditorCommand) => void }) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {TOOLBAR_ITEMS.map((item) => (
        <button
          key={item.command}
          className={`tool ${item.command}`}
          type="button"
          aria-label={item.label}
          title={item.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onCommand(item.command)}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}
