import { isValidRoomId } from "@/lib/room";
import { getSignalingStore, SignalingConfigError, signalingEnvironment } from "@/signaling/get-store";
import {
  isPeerId,
  MAX_REQUEST_CHARS,
  MAX_SIGNAL_BODY_CHARS,
  type SignalEnvelope,
} from "@/types/signaling";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function unavailable(): Response {
  return json({ error: "unconfigured" }, 503);
}

async function readBody(request: Request): Promise<{ text: string } | Response> {
  const text = await request.text();
  if (text.length > MAX_REQUEST_CHARS) return json({ error: "too_large" }, 413);
  return { text };
}

function invalidRoom(roomId: string): Response | null {
  if (!isValidRoomId(roomId)) return json({ error: "invalid_room" }, 400);
  return null;
}

export async function postPresence(request: Request, roomId: string): Promise<Response> {
  const roomError = invalidRoom(roomId);
  if (roomError) return roomError;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  let peerId = "";
  try {
    const parsed = JSON.parse(body.text) as { peerId?: unknown };
    if (typeof parsed.peerId !== "string" || !isPeerId(parsed.peerId)) {
      return json({ error: "invalid_peer" }, 400);
    }
    peerId = parsed.peerId;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  try {
    const store = getSignalingStore();
    const now = Date.now();
    const env = signalingEnvironment();
    await store.heartbeat(env, roomId, peerId, now);
    const roster = await store.roster(env, roomId, now);
    return json({ ok: true, roster });
  } catch (error) {
    if (error instanceof SignalingConfigError) return unavailable();
    return json({ error: "store_failed" }, 500);
  }
}

export async function deletePresence(request: Request, roomId: string): Promise<Response> {
  const roomError = invalidRoom(roomId);
  if (roomError) return roomError;
  const peerId = new URL(request.url).searchParams.get("peerId") ?? "";
  if (!isPeerId(peerId)) return json({ error: "invalid_peer" }, 400);
  try {
    await getSignalingStore().remove(signalingEnvironment(), roomId, peerId);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof SignalingConfigError) return unavailable();
    return json({ error: "store_failed" }, 500);
  }
}

export async function getPeers(request: Request, roomId: string): Promise<Response> {
  const roomError = invalidRoom(roomId);
  if (roomError) return roomError;
  const peerId = new URL(request.url).searchParams.get("peerId") ?? "";
  if (!isPeerId(peerId)) return json({ error: "invalid_peer" }, 400);
  try {
    const roster = await getSignalingStore().roster(signalingEnvironment(), roomId, Date.now());
    return json({
      peers: roster.filter((entry) => entry.id !== peerId).map((entry) => entry.id),
      roster,
    });
  } catch (error) {
    if (error instanceof SignalingConfigError) return unavailable();
    return json({ error: "store_failed" }, 500);
  }
}

export async function postSignal(request: Request, roomId: string): Promise<Response> {
  const roomError = invalidRoom(roomId);
  if (roomError) return roomError;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  let envelope: SignalEnvelope;
  try {
    const parsed = JSON.parse(body.text) as Partial<SignalEnvelope>;
    if (
      typeof parsed.to !== "string" ||
      typeof parsed.from !== "string" ||
      typeof parsed.id !== "string" ||
      typeof parsed.body !== "string" ||
      !isPeerId(parsed.to) ||
      !isPeerId(parsed.from) ||
      !isPeerId(parsed.id) ||
      parsed.to === parsed.from
    ) {
      return json({ error: "invalid_envelope" }, 400);
    }
    if (parsed.body.length > MAX_SIGNAL_BODY_CHARS) return json({ error: "too_large" }, 413);
    envelope = { to: parsed.to, from: parsed.from, id: parsed.id, body: parsed.body };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  try {
    await getSignalingStore().post(signalingEnvironment(), roomId, envelope, Date.now());
    return json({ ok: true });
  } catch (error) {
    if (error instanceof SignalingConfigError) return unavailable();
    return json({ error: "store_failed" }, 500);
  }
}

export async function getSignal(request: Request, roomId: string): Promise<Response> {
  const roomError = invalidRoom(roomId);
  if (roomError) return roomError;
  const peerId = new URL(request.url).searchParams.get("peerId") ?? "";
  if (!isPeerId(peerId)) return json({ error: "invalid_peer" }, 400);
  try {
    const messages = await getSignalingStore().drain(
      signalingEnvironment(),
      roomId,
      peerId,
      Date.now(),
    );
    return json({ messages });
  } catch (error) {
    if (error instanceof SignalingConfigError) return unavailable();
    return json({ error: "store_failed" }, 500);
  }
}
