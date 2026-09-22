import type { CloudPublic, CloudUnlocked } from "@/signaling/store";

async function send(roomId: string, body: unknown): Promise<Response> {
  return fetch(`/api/rooms/${roomId}/cloud`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchCloud(roomId: string): Promise<CloudPublic> {
  const response = await fetch(`/api/rooms/${roomId}/cloud`, { cache: "no-store" });
  if (!response.ok) throw new Error("cloud");
  return (await response.json()) as CloudPublic;
}

export async function unlockCloud(roomId: string, verifier: string): Promise<CloudUnlocked | null> {
  const response = await send(roomId, { action: "unlock", verifier });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("cloud");
  return (await response.json()) as CloudUnlocked;
}

export async function appendCloud(roomId: string, update: string, verifier: string | null): Promise<"ok" | "full"> {
  const response = await send(roomId, { action: "append", update, verifier });
  if (response.status === 409) return "full";
  if (!response.ok) throw new Error("cloud");
  return "ok";
}

export async function compactCloud(
  roomId: string,
  expectedLength: number,
  snapshot: string,
  verifier: string | null,
): Promise<boolean> {
  const response = await send(roomId, { action: "compact", expectedLength, snapshot, verifier });
  return response.ok;
}

export async function protectCloud(
  roomId: string,
  salt: string,
  verifier: string,
  snapshot: string,
  previousVerifier: string | null,
): Promise<boolean> {
  const response = await send(roomId, { action: "protect", salt, verifier, snapshot, previousVerifier });
  return response.ok;
}

export async function unprotectCloud(roomId: string, verifier: string, snapshot: string): Promise<boolean> {
  const response = await send(roomId, { action: "unprotect", verifier, snapshot });
  return response.ok;
}
