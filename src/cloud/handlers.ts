import { isCloudUpdate, isSalt, isVerifier } from "@/cloud/limits";
import { getSignalingStore, SignalingConfigError, signalingEnvironment } from "@/signaling/get-store";
import { isValidRoomId } from "@/lib/room";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function unavailable(): Response {
  return json({ error: "unconfigured" }, 503);
}

export async function getCloud(roomId: string): Promise<Response> {
  if (!isValidRoomId(roomId)) return json({ error: "invalid_room" }, 400);
  try {
    const cloud = await getSignalingStore().readCloud(signalingEnvironment(), roomId);
    return json(cloud);
  } catch (error) {
    if (error instanceof SignalingConfigError) return unavailable();
    return json({ error: "store_failed" }, 500);
  }
}

type CloudCommand =
  | { action: "unlock"; verifier: string }
  | { action: "append"; update: string; verifier?: string }
  | { action: "compact"; expectedLength: number; snapshot: string; verifier?: string }
  | { action: "protect"; salt: string; verifier: string; snapshot: string; previousVerifier?: string }
  | { action: "unprotect"; verifier: string; snapshot: string };

export async function postCloud(request: Request, roomId: string): Promise<Response> {
  if (!isValidRoomId(roomId)) return json({ error: "invalid_room" }, 400);
  const text = await request.text();
  if (text.length > 450_000) return json({ error: "too_large" }, 413);
  let command: CloudCommand;
  try {
    command = JSON.parse(text) as CloudCommand;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  try {
    const store = getSignalingStore();
    const env = signalingEnvironment();
    if (command.action === "unlock") {
      if (!isVerifier(command.verifier)) return json({ error: "invalid_verifier" }, 400);
      const opened = await store.unlockCloud(env, roomId, command.verifier);
      if (!opened) return json({ error: "denied" }, 401);
      return json(opened);
    }
    if (command.action === "append") {
      if (!isCloudUpdate(command.update)) return json({ error: "invalid_update" }, 400);
      const verifier = optionalVerifier(command.verifier);
      if (verifier === false) return json({ error: "invalid_verifier" }, 400);
      const result = await store.appendCloud(env, roomId, command.update, verifier);
      return writeResult(result);
    }
    if (command.action === "compact") {
      if (!isCloudUpdate(command.snapshot) || !Number.isInteger(command.expectedLength) || command.expectedLength < 0) {
        return json({ error: "invalid_update" }, 400);
      }
      const verifier = optionalVerifier(command.verifier);
      if (verifier === false) return json({ error: "invalid_verifier" }, 400);
      const result = await store.compactCloud(env, roomId, command.expectedLength, command.snapshot, verifier);
      return writeResult(result);
    }
    if (command.action === "protect") {
      if (!isSalt(command.salt) || !isVerifier(command.verifier) || !isCloudUpdate(command.snapshot)) {
        return json({ error: "invalid_update" }, 400);
      }
      const previous = optionalVerifier(command.previousVerifier);
      if (previous === false) return json({ error: "invalid_verifier" }, 400);
      const protectedNote = await store.protectCloud(env, roomId, command.salt, command.verifier, command.snapshot, previous);
      if (!protectedNote) return json({ error: "denied" }, 401);
      return json({ ok: true });
    }
    if (command.action === "unprotect") {
      if (!isVerifier(command.verifier) || !isCloudUpdate(command.snapshot)) return json({ error: "invalid_update" }, 400);
      const ok = await store.unprotectCloud(env, roomId, command.verifier, command.snapshot);
      if (!ok) return json({ error: "denied" }, 401);
      return json({ ok: true });
    }
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof SignalingConfigError) return unavailable();
    return json({ error: "store_failed" }, 500);
  }
}

function optionalVerifier(value: unknown): string | null | false {
  if (value == null || value === "") return null;
  return isVerifier(value) ? value : false;
}

function writeResult(result: "ok" | "denied" | "full"): Response {
  if (result === "denied") return json({ error: "denied" }, 401);
  if (result === "full") return json({ error: "full" }, 409);
  return json({ ok: true });
}
