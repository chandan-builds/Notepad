"use client";

import { useEffect, useState } from "react";
import { CollaborationSession } from "@/collaboration/session";
import { MessagePage } from "@/components/MessagePage";
import { NotepadShell } from "@/components/NotepadShell";
import { NotepadEditor } from "@/editor/NotepadEditor";
import { useSession } from "@/hooks/useSession";
import { parseFragmentKey } from "@/lib/room";

export function NotepadApp({ roomId }: { roomId: string }) {
  const [fragmentKey, setFragmentKey] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setFragmentKey(parseFragmentKey(window.location.hash));
  }, []);

  if (fragmentKey === undefined) {
    return (
      <MessagePage
        eyebrow="Field note"
        title="Opening the note…"
        body="Reading the link on this device."
      />
    );
  }

  if (fragmentKey === null) {
    return (
      <MessagePage
        eyebrow="Link incomplete"
        title="This page needs the full link."
        body="The secret after the # never reaches the server, so it cannot be recovered from the address alone. Open the full link that was shared with you."
      />
    );
  }

  return <LiveNotepad roomId={roomId} fragmentKey={fragmentKey} />;
}

function LiveNotepad({ roomId, fragmentKey }: { roomId: string; fragmentKey: string }) {
  const [session, setSession] = useState<CollaborationSession | null>(null);
  const [failed, setFailed] = useState(false);
  const snapshot = useSession(session);

  useEffect(() => {
    let alive = true;
    let current: CollaborationSession | null = null;
    CollaborationSession.open(roomId, fragmentKey)
      .then((opened) => {
        if (!alive) {
          opened.destroy();
          return;
        }
        opened.start();
        current = opened;
        setSession(opened);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      current?.destroy();
    };
  }, [roomId, fragmentKey]);

  if (failed) {
    return (
      <MessagePage
        eyebrow="Couldn’t open"
        title="This note didn’t open."
        body="Refresh the page. If it keeps failing, the copy on this device may be blocked by the browser."
      />
    );
  }

  return (
    <NotepadShell
      snapshot={snapshot}
      onRetry={() => session?.retryConnections()}
      onDelete={async () => {
        await session?.deleteLocalCopy();
      }}
      editor={
        session && snapshot.ready ? (
          <NotepadEditor key={snapshot.epoch} doc={session.getDoc()} awareness={session.getAwareness()} />
        ) : null
      }
    />
  );
}
