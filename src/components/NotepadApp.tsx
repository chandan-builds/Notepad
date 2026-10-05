"use client";

import { useEffect, useState } from "react";
import { CollaborationSession, type OpenedCloud } from "@/collaboration/session";
import { fetchCloud, unlockCloud } from "@/cloud/client";
import { derivePasswordKeys } from "@/cloud/password";
import { MessagePage } from "@/components/MessagePage";
import { NotepadShell } from "@/components/NotepadShell";
import { PasswordGate } from "@/components/PasswordGate";
import { useSession } from "@/hooks/useSession";
import { base64ToBytes } from "@/lib/bytes";

export function NotepadApp({ roomId, pathSegment }: { roomId: string; pathSegment: string }) {
  const [cloud, setCloud] = useState<OpenedCloud | null>(null);
  const [salt, setSalt] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "password" | "ready" | "error">("loading");
  const [passwordError, setPasswordError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchCloud(roomId)
      .then((opened) => {
        if (!alive) return;
        if (opened.protected) {
          setSalt(opened.salt);
          setPhase("password");
          return;
        }
        setCloud({
          signalSecret: opened.signalSecret,
          updates: opened.updates,
          protectedNote: false,
          passwordKey: null,
          verifier: null,
          salt: null,
        });
        setPhase("ready");
      })
      .catch(() => {
        if (alive) setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [roomId]);

  async function unlock(password: string) {
    if (!salt) return;
    const saltBytes = base64ToBytes(salt);
    if (!saltBytes) {
      setPasswordError(true);
      return;
    }
    const derived = await derivePasswordKeys(password, saltBytes);
    const opened = await unlockCloud(roomId, derived.verifier);
    if (!opened) {
      setPasswordError(true);
      return;
    }
    setPasswordError(false);
    setCloud({
      signalSecret: opened.signalSecret,
      updates: opened.updates,
      protectedNote: true,
      passwordKey: derived.key,
      verifier: derived.verifier,
      salt,
    });
    setPhase("ready");
  }

  if (phase === "loading") {
    return <MessagePage eyebrow="Field note" title="Opening the note…" body="Reading the copy saved in the cloud." />;
  }

  if (phase === "error") {
    return (
      <MessagePage
        eyebrow="Couldn’t open"
        title="This note didn’t open."
        body="Refresh the page. If it keeps failing, the cloud copy may be unreachable."
      />
    );
  }

  if (phase === "password" || !cloud) {
    return <PasswordGate error={passwordError} onUnlock={unlock} />;
  }

  return <LiveNotepad roomId={roomId} pathSegment={pathSegment} cloud={cloud} />;
}

function LiveNotepad({ roomId, pathSegment, cloud }: { roomId: string; pathSegment: string; cloud: OpenedCloud }) {
  const [session, setSession] = useState<CollaborationSession | null>(null);
  const [failed, setFailed] = useState(false);
  const snapshot = useSession(session);

  useEffect(() => {
    let alive = true;
    let current: CollaborationSession | null = null;
    CollaborationSession.open(roomId, cloud)
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
  }, [roomId, cloud]);

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
      roomId={roomId}
      pathSegment={pathSegment}
      doc={session?.getDoc() ?? null}
      awareness={session?.getAwareness() ?? null}
      snapshot={snapshot}
      onRetry={() => session?.retryConnections()}
      onDelete={async () => {
        await session?.deleteLocalCopy();
      }}
      onSetPassword={async (password) => (await session?.setPassword(password)) ?? false}
      onClearPassword={async (password) => (await session?.clearPassword(password)) ?? false}
      onSetLive={(enabled) => session?.setLiveEnabled(enabled)}
    />
  );
}
