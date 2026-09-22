"use client";

import { useState, type ReactNode } from "react";
import { Banner } from "@/components/Banner";
import { StatusBar } from "@/components/StatusBar";
import type { SessionSnapshot } from "@/collaboration/session";

type NotepadShellProps = {
  snapshot: SessionSnapshot;
  editor: ReactNode;
  onRetry: () => void;
  onDelete: () => Promise<void>;
};

export function NotepadShell({ snapshot, editor, onRetry, onDelete }: NotepadShellProps) {
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function share() {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setShareFailed(false);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setShareFailed(true);
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

  return (
    <main className="sheet">
      <div className="sheet-tab" aria-hidden="true" />
      <header className="sheet-head">
        <div>
          <a className="mark" href="/">
            Notepad
          </a>
          <p className="mark-note">Anyone with the full link can edit.</p>
        </div>
        <div className="actions">
          {confirming ? (
            <div className="confirm">
              <span>Delete only this device’s copy?</span>
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
          <button className="share" type="button" disabled={!snapshot.canShare} onClick={() => void share()}>
            {copied ? "Link copied" : "Share link"}
          </button>
        </div>
      </header>
      {shareFailed ? (
        <p className="share-fallback">
          Copy this address, including the part after #: <code>{typeof window !== "undefined" ? window.location.href : ""}</code>
        </p>
      ) : null}
      <Banner banners={snapshot.banners} canRetry={snapshot.canRetry} onRetry={onRetry} />
      <div className="editor-slot">{snapshot.ready ? editor : <p className="opening">Opening the note on this device…</p>}</div>
      <footer className="sheet-foot">
        <StatusBar
          label={snapshot.statusLabel}
          detail={snapshot.statusDetail}
          peerCount={snapshot.peerCount}
          canRetry={snapshot.canRetry && snapshot.phase !== "ice-failed"}
          onRetry={onRetry}
        />
        <p className="limits">
          Stored only on devices that have opened this link. Others see edits while you are connected to each other. If
          every device loses its copy, the note is gone.
        </p>
      </footer>
    </main>
  );
}
