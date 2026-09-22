export const PEER_TTL_MS = 30_000;
export const MAILBOX_TTL_MS = 120_000;
export const MAILBOX_CAP = 50;
export const MAX_SIGNAL_BODY_CHARS = 32 * 1024;
export const MAX_REQUEST_CHARS = 48 * 1024;
export const ROOM_PEER_CAP = 8;
export const FRAME_CHUNK_BYTES = 16 * 1024;

export const HEARTBEAT_MS = 10_000;
export const PEER_POLL_MS = 15_000;
export const MAILBOX_POLL_MS = 1_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPeerId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export type RosterEntry = {
  id: string;
  joinedAt: number;
};

export type SignalEnvelope = {
  to: string;
  from: string;
  id: string;
  body: string;
};

export type SignalPayload =
  | { kind: "description"; description: { type: RTCSdpType; sdp: string } }
  | { kind: "candidate"; candidate: RTCIceCandidateInit | null };

export function isSignalPayload(value: unknown): value is SignalPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as SignalPayload;
  if (payload.kind === "description") {
    const description = payload.description;
    return (
      !!description &&
      (description.type === "offer" || description.type === "answer" || description.type === "rollback" || description.type === "pranswer") &&
      typeof description.sdp === "string" &&
      description.sdp.length > 0 &&
      description.sdp.length < 28_000
    );
  }
  if (payload.kind === "candidate") {
    if (payload.candidate === null) return true;
    const candidate = payload.candidate;
    return !!candidate && typeof candidate === "object";
  }
  return false;
}
