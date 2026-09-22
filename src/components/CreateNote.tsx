"use client";

import { useState, type FormEvent } from "react";
import { noteCodePath, parseShareCode, randomSecret } from "@/lib/room";

export function CreateNote() {
  function start() {
    window.location.assign(noteCodePath(randomSecret()));
  }

  return (
    <button className="share start" type="button" onClick={start}>
      Start a note
    </button>
  );
}

export function OpenNote() {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  function open(event: FormEvent) {
    event.preventDefault();
    const roomId = parseShareCode(value);
    if (!roomId) {
      setError(true);
      return;
    }
    window.location.assign(noteCodePath(roomId));
  }

  return (
    <form className="open-note" onSubmit={open}>
      <label htmlFor="share-code">Open with a code</label>
      <div className="open-row">
        <input
          id="share-code"
          value={value}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Code or full link"
          onChange={(event) => {
            setValue(event.target.value);
            setError(false);
          }}
        />
        <button className="share" type="submit">
          Open
        </button>
      </div>
      <p className="field-hint">
        Use the last part of the link, after /n/. It has to match exactly. A new code starts an empty note.
      </p>
      {error ? (
        <p className="field-error" role="alert">
          That isn’t a note code.
        </p>
      ) : null}
    </form>
  );
}
