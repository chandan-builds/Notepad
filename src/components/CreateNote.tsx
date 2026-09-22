"use client";

import { createNoteAddress, notePath } from "@/lib/room";

export function CreateNote() {
  function start() {
    const { roomId, key } = createNoteAddress();
    window.location.assign(notePath(roomId, key));
  }

  return (
    <button className="share start" type="button" onClick={start}>
      Start a note
    </button>
  );
}
