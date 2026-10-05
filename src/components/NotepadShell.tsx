"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { SessionPhase, SessionSnapshot } from "@/collaboration/session";
import { Banner } from "@/components/Banner";
import { EditorToolbar } from "@/components/EditorToolbar";
import { NoteTabBar } from "@/components/NoteTabBar";
import { StatusBar } from "@/components/StatusBar";
import { NotepadEditor } from "@/editor/NotepadEditor";
import { stripFormatting, type EditorCommand } from "@/editor/format";
import { setNoteSlug, setNoteTitle } from "@/editor/note-model";
import { useNoteModel } from "@/hooks/useNoteModel";
import { EMPTY_SCROLL, useCanvasPip, type EditorScrollState } from "@/hooks/useCanvasPip";
import { useSaveLabel } from "@/hooks/useSaveLabel";
import { useTheme } from "@/hooks/useTheme";
import { takePendingTitle } from "@/lib/pending-title";
import { isValidNoteSlug, sanitizeSlug } from "@/lib/slug";

type NotepadShellProps = {
  roomId: string;
  pathSegment: string;
  doc: Y.Doc | null;
  awareness: Awareness | null;
  snapshot: SessionSnapshot;
  onRetry: () => void;
  onDelete: () => Promise<void>;
  onSetPassword: (password: string) => Promise<boolean>;
  onClearPassword: (password: string) => Promise<boolean>;
  onSetLive: (enabled: boolean) => void;
};

export function NotepadShell({
  roomId,
  pathSegment,
  doc,
  awareness,
  snapshot,
  onRetry,
  onDelete,
  onSetPassword,
  onClearPassword,
  onSetLive,
}: NotepadShellProps) {
  const note = useNoteModel(doc);
  const { toggleTheme } = useTheme();
  const saveLabel = useSaveLabel(doc, snapshot.cloudDown);
  const [scrollState, setScrollState] = useState<EditorScrollState>(EMPTY_SCROLL);
  const { openPip, isSupported: isPipSupported } = useCanvasPip({
    title: note.title,
    content: stripFormatting(note.activeText),
    scrollState,
  });
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [nextConfirm, setNextConfirm] = useState("");
  const [lockError, setLockError] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [slugInput, setSlugInput] = useState(isValidNoteSlug(pathSegment) ? pathSegment : "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugError, setSlugError] = useState("");
  const [slugBusy, setSlugBusy] = useState(false);
  const [applyFormat, setApplyFormat] = useState<((command: EditorCommand) => void) | null>(null);

  useEffect(() => {
    if (slugTouched) return;
    if (isValidNoteSlug(pathSegment)) {
      setSlugInput(pathSegment);
      return;
    }
    if (note.slug) setSlugInput(note.slug);
  }, [note.slug, pathSegment, slugTouched]);

  useEffect(() => {
    if (!doc || !snapshot.ready || !isValidNoteSlug(pathSegment)) return;
    const pending = takePendingTitle(pathSegment);
    if (!pending) return;
    const current = doc.getMap("meta").get("title");
    if (typeof current !== "string" || current.trim() === "" || current === "Untitled Note") {
      setNoteTitle(doc, pending);
    }
    if (doc.getMap("meta").get("slug") !== pathSegment) setNoteSlug(doc, pathSegment);
  }, [doc, pathSegment, snapshot.ready]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(window.location.href.split("#")[0]);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopyFailed(true);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete();
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (lockBusy) return;
    setLockError("");
    if (snapshot.protectedNote) {
      setLockBusy(true);
      try {
        const ok = await onClearPassword(password);
        if (!ok) {
          setLockError("That password doesn’t match.");
          return;
        }
        setPassword("");
        setLocking(false);
      } finally {
        setLockBusy(false);
      }
      return;
    }
    if (password.length < 4) {
      setLockError("Password must be at least 4 characters.");
      return;
    }
    if (password !== confirm) {
      setLockError("The two passwords don’t match.");
      return;
    }
    setLockBusy(true);
    try {
      const ok = await onSetPassword(password);
      if (!ok) {
        setLockError("The password couldn’t be saved. Try again.");
        return;
      }
      setPassword("");
      setConfirm("");
      setLocking(false);
    } finally {
      setLockBusy(false);
    }
  }

  async function updatePassword() {
    if (lockBusy) return;
    setLockError("");
    if (nextPassword.length < 4) {
      setLockError("Password must be at least 4 characters.");
      return;
    }
    if (nextPassword !== nextConfirm) {
      setLockError("The two passwords don’t match.");
      return;
    }
    setLockBusy(true);
    try {
      const ok = await onSetPassword(nextPassword);
      if (!ok) {
        setLockError("The password couldn’t be saved. Try again.");
        return;
      }
      setNextPassword("");
      setNextConfirm("");
      setLockError("");
      setLocking(false);
    } finally {
      setLockBusy(false);
    }
  }

  async function applyPath() {
    const slug = sanitizeSlug(slugInput);
    setSlugError("");
    if (!slug || !isValidNoteSlug(slug)) {
      setSlugError(
        slug.length === 22 ? "That path is reserved. Try a different length." : "Use letters, numbers, and hyphens.",
      );
      return;
    }
    if (slug === pathSegment) return;
    setSlugBusy(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/path`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (response.status === 409) {
        setSlugError("This path is already taken. Try a different name.");
        return;
      }
      if (!response.ok) {
        setSlugError("Unable to update the note path right now. Please try again.");
        return;
      }
      note.setSlug(slug);
      window.location.assign(`/n/${slug}`);
    } catch {
      setSlugError("Unable to update the note path right now. Please try again.");
    } finally {
      setSlugBusy(false);
    }
  }

  return (
    <main className="sheet">
      <div className="sheet-tab" aria-hidden="true" />
      <header className="sheet-head">
        <div>
          <a className="mark" href="/">
            Notepad
          </a>
          <p className="mark-note">
            {snapshot.protectedNote ? "A password is required to open this note." : "Saved in the cloud and on this device."}
          </p>
        </div>
        <div className="actions">
          {confirming ? (
            <div className="confirm">
              <span>Delete only this device’s copy? The cloud copy stays.</span>
              <button className="text-button" type="button" onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <button className="danger-button" type="button" disabled={deleting} onClick={() => void confirmDelete()}>
                {deleting ? "Deleting…" : "Delete it"}
              </button>
            </div>
          ) : (
            <button className="text-button" type="button" onClick={() => setConfirming(true)}>
              Delete local copy
            </button>
          )}
          <button className="text-button" type="button" onClick={() => void copyUrl()} disabled={!snapshot.canShare}>
            {copied ? "Copied" : "Copy URL"}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => void openPip()}
            disabled={!isPipSupported}
            title={isPipSupported ? "Open in a sticky window" : "Sticky notes aren’t available in this browser"}
          >
            Sticky
          </button>
          <button className="text-button" type="button" disabled={!snapshot.ready} onClick={() => setLocking((open) => !open)}>
            {snapshot.protectedNote ? "Password" : "Add password"}
          </button>
          <button className="text-button" type="button" onClick={toggleTheme}>
            Theme
          </button>
        </div>
      </header>
      <label className="title-field" htmlFor="note-title">
        <span>Title</span>
        <input
          id="note-title"
          value={note.title}
          maxLength={80}
          placeholder="Untitled Note"
          disabled={!snapshot.ready}
          onChange={(event) => note.setTitle(event.target.value)}
        />
      </label>
      <div className="path-row">
        <span aria-hidden="true">/</span>
        <input
          aria-label="Custom path"
          value={slugInput}
          placeholder="custom-note-path"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={!snapshot.ready}
          onChange={(event) => {
            setSlugTouched(true);
            setSlugInput(event.target.value);
            setSlugError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void applyPath();
            }
          }}
        />
        <button className="text-button" type="button" disabled={!snapshot.ready || slugBusy} onClick={() => void applyPath()}>
          {slugBusy ? "Applying…" : "Apply"}
        </button>
      </div>
      {slugError ? (
        <p className="field-error path-error" role="alert">
          {slugError}
        </p>
      ) : null}
      {copyFailed ? (
        <p className="share-fallback">
          Copy this address: <code>{typeof window !== "undefined" ? window.location.href.split("#")[0] : ""}</code>
        </p>
      ) : null}
      {locking ? (
        <form className="lock-form" onSubmit={(event) => void submitPassword(event)}>
          <label htmlFor="lock-password">{snapshot.protectedNote ? "Current password" : "Password"}</label>
          <input
            id="lock-password"
            type="password"
            autoComplete={snapshot.protectedNote ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {snapshot.protectedNote ? null : (
            <>
              <label htmlFor="lock-confirm">Confirm password</label>
              <input
                id="lock-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </>
          )}
          <button className="share" type="submit" disabled={lockBusy || password.length === 0}>
            {lockBusy && !snapshot.protectedNote ? "Saving…" : snapshot.protectedNote ? "Remove password" : "Protect note"}
          </button>
          {snapshot.protectedNote ? (
            <>
              <label htmlFor="next-password">New password</label>
              <input
                id="next-password"
                type="password"
                autoComplete="new-password"
                value={nextPassword}
                onChange={(event) => setNextPassword(event.target.value)}
              />
              <label htmlFor="next-confirm">Confirm new password</label>
              <input
                id="next-confirm"
                type="password"
                autoComplete="new-password"
                value={nextConfirm}
                onChange={(event) => setNextConfirm(event.target.value)}
              />
              <button
                className="share"
                type="button"
                disabled={lockBusy || nextPassword.length === 0}
                onClick={() => void updatePassword()}
              >
                {lockBusy ? "Saving…" : "Update password"}
              </button>
            </>
          ) : null}
          {lockError ? (
            <p className="field-error" role="alert">
              {lockError}
            </p>
          ) : null}
        </form>
      ) : null}
      <Banner banners={snapshot.banners} canRetry={snapshot.canRetry} onRetry={onRetry} />
      <div className="editor-slot">
        {snapshot.ready && doc && awareness && note.ytext ? (
          <>
            <EditorToolbar onCommand={(command) => applyFormat?.(command)} />
            <div className="editor-meta">
              <span className="meta-pill">{saveLabel}</span>
              <NoteTabBar
                tabs={note.tabs}
                activeTabId={note.activeTabId}
                canAdd={note.canAddTab}
                onSelect={note.selectTab}
                onAdd={note.addTab}
                onClose={note.closeTab}
                onRename={note.renameTab}
                onReorder={note.reorderTabs}
              />
              <button className="live-toggle" type="button" onClick={() => onSetLive(!snapshot.liveEnabled)}>
                {liveLabel(snapshot.liveEnabled, snapshot.phase)}
              </button>
              <span className="meta-pill words">
                {note.wordCount} {note.wordCount === 1 ? "word" : "words"}
              </span>
            </div>
              <NotepadEditor
              key={note.activeTabId}
              text={note.ytext}
              awareness={awareness}
              onScroll={setScrollState}
              onCommand={(apply) => setApplyFormat(() => apply)}
            />
          </>
        ) : (
          <p className="opening">Opening the note on this device…</p>
        )}
      </div>
      <footer className="sheet-foot">
        <StatusBar
          label={snapshot.statusLabel}
          detail={snapshot.statusDetail}
          peerCount={snapshot.peerCount}
          canRetry={snapshot.canRetry && snapshot.phase !== "ice-failed"}
          onRetry={onRetry}
        />
        <p className="limits">
          Saved in the cloud and on this device. A password keeps the cloud copy unreadable. If the cloud copy and every
          device copy are gone, the note is gone.
        </p>
      </footer>
    </main>
  );
}

function liveLabel(enabled: boolean, phase: SessionPhase): string {
  if (!enabled) return "Live Off";
  if (phase === "connecting" || phase === "reconnecting") return "Live Connecting";
  if (phase === "ice-failed" || phase === "signaling" || phase === "offline" || phase === "room-full") return "Live Error";
  return "Live On";
}
