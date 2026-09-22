"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Banner } from "@/components/Banner";
import { StatusBar } from "@/components/StatusBar";
import type { SessionSnapshot } from "@/collaboration/session";

type NotepadShellProps = {
  roomId: string;
  snapshot: SessionSnapshot;
  editor: ReactNode;
  onRetry: () => void;
  onDelete: () => Promise<void>;
  onSetPassword: (password: string) => Promise<boolean>;
  onClearPassword: (password: string) => Promise<boolean>;
};

export function NotepadShell({
  roomId,
  snapshot,
  editor,
  onRetry,
  onDelete,
  onSetPassword,
  onClearPassword,
}: NotepadShellProps) {
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [lockError, setLockError] = useState("");
  const [lockBusy, setLockBusy] = useState(false);

  async function share() {
    const href = window.location.href.split("#")[0];
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

  return (
    <main className="sheet">
      <div className="sheet-tab" aria-hidden="true" />
      <header className="sheet-head">
        <div>
          <a className="mark" href="/">
            Notepad
          </a>
          <p className="mark-note">
            {snapshot.protectedNote ? "A password is required to open this note." : "Anyone with the code can open it."}
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
          <button className="text-button" type="button" onClick={() => setLocking((open) => !open)}>
            {snapshot.protectedNote ? "Remove password" : "Add password"}
          </button>
          <button className="share" type="button" disabled={!snapshot.canShare} onClick={() => void share()}>
            {copied ? "Link copied" : "Share link"}
          </button>
        </div>
      </header>
      <p className="share-code">
        Code <code>{roomId}</code>
      </p>
      {shareFailed ? (
        <p className="share-fallback">
          Copy this address, or just the code after /n/: <code>{typeof window !== "undefined" ? window.location.href.split("#")[0] : ""}</code>
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
            {lockBusy ? "Saving…" : snapshot.protectedNote ? "Remove password" : "Protect note"}
          </button>
          {lockError ? (
            <p className="field-error" role="alert">
              {lockError}
            </p>
          ) : null}
        </form>
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
          Saved in the cloud and on this device. Share the code, the last part of the link after /n/. A password keeps
          the cloud copy unreadable. If the cloud copy and every device copy are gone, the note is gone.
        </p>
      </footer>
    </main>
  );
}
