import { ROOM_PEER_CAP, type RosterEntry } from "@/types/signaling";

export function admitPeers(
  roster: RosterEntry[],
  selfId: string,
  cap = ROOM_PEER_CAP,
): { roomFull: boolean; remoteIds: string[] } {
  const sorted = [...roster].sort(
    (a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const admitted = sorted.slice(0, cap);
  const roomFull = !admitted.some((entry) => entry.id === selfId);
  return {
    roomFull,
    remoteIds: roomFull ? [] : admitted.map((entry) => entry.id).filter((id) => id !== selfId),
  };
}
