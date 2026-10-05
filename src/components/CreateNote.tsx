"use client";

import { useState, type FormEvent } from "react";
import { TITLE_MAX } from "@/editor/note-model";
import { rememberPendingTitle } from "@/lib/pending-title";
import { randomSecret } from "@/lib/room";
import { linkSlugFromTitle, sanitizeSlug } from "@/lib/slug";

export function CreateNote() {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const slug = linkSlugFromTitle(name);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const title = name.trim().slice(0, TITLE_MAX);
    const nextSlug = linkSlugFromTitle(title);
    if (!nextSlug) {
      setError(
        sanitizeSlug(title).length === 22
          ? "That name is reserved. Try a different one."
          : "Use letters or numbers in the name.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const roomId = randomSecret();
    try {
      const response = await fetch(`/api/rooms/${roomId}/path`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: nextSlug }),
      });
      if (response.status === 409) {
        setError("A note already uses that name. Try a different one.");
        return;
      }
      if (!response.ok) {
        setError("The note couldn’t be started. Try again.");
        return;
      }
      rememberPendingTitle(nextSlug, title);
      window.location.assign(`/n/${nextSlug}`);
    } catch {
      setError("The note couldn’t be started. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="open-note" onSubmit={(event) => void start(event)}>
      <label htmlFor="note-name">Name this note</label>
      <div className="open-row">
        <input
          id="note-name"
          value={name}
          maxLength={TITLE_MAX}
          placeholder="Meeting notes"
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
        <button className="share" type="submit" disabled={busy || name.trim().length === 0}>
          {busy ? "Starting…" : "Start a note"}
        </button>
      </div>
      <p className="field-hint">{slug ? `The link will be /n/${slug}` : "The link is created from this name."}</p>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
