"use client";

import { noteCodePath, randomSecret } from "@/lib/room";

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
