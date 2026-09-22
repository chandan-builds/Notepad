"use client";

import { useSyncExternalStore } from "react";
import { CollaborationSession, openingSnapshot, type SessionSnapshot } from "@/collaboration/session";

export function useSession(session: CollaborationSession | null): SessionSnapshot {
  return useSyncExternalStore(
    (notify) => (session ? session.subscribe(notify) : () => undefined),
    () => (session ? session.getSnapshot() : openingSnapshot),
    () => openingSnapshot,
  );
}
