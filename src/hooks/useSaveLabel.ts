"use client";

import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { CLOUD_ORIGIN } from "@/cloud/sync";

export function useSaveLabel(doc: Y.Doc | null, cloudDown: boolean): string {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) return;
    let armed = false;
    const arm = window.setTimeout(() => {
      armed = true;
    }, 400);
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (!armed || origin === CLOUD_ORIGIN) return;
      setStatus("saving");
    };
    doc.on("update", onUpdate);
    return () => {
      window.clearTimeout(arm);
      doc.off("update", onUpdate);
    };
  }, [doc]);

  useEffect(() => {
    if (status !== "saving") return;
    const timer = window.setTimeout(() => {
      if (cloudDown) {
        setStatus("error");
        return;
      }
      setSavedAt(new Date().toISOString());
      setStatus("saved");
    }, 700);
    return () => window.clearTimeout(timer);
  }, [cloudDown, status]);

  if (status === "saving") return "Saving...";
  if (status === "error") return "Save failed";
  if (savedAt) {
    const savedTime = new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `Saved ${savedTime}`;
  }
  return "Not saved yet";
}
