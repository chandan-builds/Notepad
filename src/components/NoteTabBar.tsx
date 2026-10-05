"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteTabView } from "@/editor/note-model";

type NoteTabBarProps = {
  tabs: NoteTabView[];
  activeTabId: string;
  canAdd: boolean;
  onSelect: (tabId: string) => void;
  onAdd: () => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, title: string) => void;
  onReorder: (fromId: string, toId: string) => void;
};

export function NoteTabBar({ tabs, activeTabId, canAdd, onSelect, onAdd, onClose, onRename, onReorder }: NoteTabBarProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameCommitRef = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const canClose = tabs.length > 1;
  const activeEditingId = tabs.some((tab) => tab.id === editingId) ? editingId : null;

  useEffect(() => {
    const activeTab = stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  useEffect(() => {
    if (!activeEditingId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [activeEditingId]);

  function startRename(tab: NoteTabView) {
    setEditingId(tab.id);
    setDraftTitle(tab.label);
  }

  function commitRename() {
    if (skipRenameCommitRef.current) {
      skipRenameCommitRef.current = false;
      return;
    }
    if (!activeEditingId) return;
    const tab = tabs.find((item) => item.id === activeEditingId);
    setEditingId(null);
    if (!tab || draftTitle.trim() === tab.label) return;
    onRename(tab.id, draftTitle);
  }

  function focusTabAt(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    onSelect(tab.id);
    stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tab.id)}"]`)?.focus();
  }

  return (
    <div className="tab-bar">
      <div ref={stripRef} role="tablist" aria-label="Note tabs" className="tab-strip">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isEditing = activeEditingId === tab.id;
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={isEditing ? -1 : 0}
              aria-selected={isActive}
              aria-label={tab.label}
              data-tab-id={tab.id}
              title={tab.label}
              draggable={!isEditing}
              onClick={() => onSelect(tab.id)}
              onDoubleClick={(event) => {
                const target = event.target;
                if (target instanceof Element && target.closest("button")) return;
                event.preventDefault();
                startRename(tab);
              }}
              onAuxClick={(event) => {
                if (event.button !== 1 || !canClose) return;
                event.preventDefault();
                onClose(tab.id);
              }}
              onKeyDown={(event) => {
                if (isEditing) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(tab.id);
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  focusTabAt(Math.min(tabs.length - 1, index + 1));
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  focusTabAt(Math.max(0, index - 1));
                }
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", tab.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverId(tab.id);
              }}
              onDragLeave={() => setDragOverId((current) => (current === tab.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setDragOverId(null);
                const fromId = event.dataTransfer.getData("text/plain");
                if (fromId) onReorder(fromId, tab.id);
              }}
              className={`note-tab${isActive ? " is-active" : ""}${dragOverId === tab.id ? " is-drop" : ""}`}
            >
              {isEditing ? (
                <input
                  ref={renameInputRef}
                  value={draftTitle}
                  maxLength={40}
                  aria-label="Tab name"
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitRename();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      skipRenameCommitRef.current = true;
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <span>{tab.label}</span>
              )}
              {canClose ? (
                <button
                  type="button"
                  aria-label={`Close ${tab.label}`}
                  title={`Close ${tab.label}`}
                  draggable={false}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="tab-add"
        aria-label="New tab"
        title={canAdd ? "New tab" : "Tab limit reached"}
        onClick={onAdd}
        disabled={!canAdd}
      >
        +
      </button>
    </div>
  );
}
