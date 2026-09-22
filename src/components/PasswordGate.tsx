"use client";

import { useState, type FormEvent } from "react";

export function PasswordGate({
  error,
  onUnlock,
}: {
  error: boolean;
  onUnlock: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      await onUnlock(password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="sheet sheet-message">
      <div className="sheet-tab" aria-hidden="true" />
      <p className="eyebrow">Locked note</p>
      <h1>This note has a password.</h1>
      <p className="lede">The text stays unreadable until the password is entered.</p>
      <form className="gate-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="note-password">Password</label>
        <input
          id="note-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button className="share" type="submit" disabled={busy || password.length === 0}>
          {busy ? "Checking…" : "Open note"}
        </button>
        {error ? (
          <p className="field-error" role="alert">
            That password doesn’t open this note.
          </p>
        ) : null}
      </form>
    </main>
  );
}
