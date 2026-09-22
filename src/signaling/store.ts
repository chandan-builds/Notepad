import type { RosterEntry, SignalEnvelope } from "@/types/signaling";

export interface SignalingStore {
  heartbeat(env: string, roomId: string, peerId: string, now: number): Promise<void>;
  remove(env: string, roomId: string, peerId: string): Promise<void>;
  roster(env: string, roomId: string, now: number): Promise<RosterEntry[]>;
  post(env: string, roomId: string, envelope: SignalEnvelope, now: number): Promise<void>;
  drain(env: string, roomId: string, peerId: string, now: number): Promise<SignalEnvelope[]>;
}
