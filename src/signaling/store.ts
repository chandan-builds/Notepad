import type { RosterEntry, SignalEnvelope } from "@/types/signaling";

export type CloudPublic =
  | { protected: false; signalSecret: string; updates: string[] }
  | { protected: true; salt: string };

export type CloudUnlocked = {
  signalSecret: string;
  updates: string[];
  salt: string | null;
};

export type CloudWriteResult = "ok" | "denied" | "full";

export interface SignalingStore {
  heartbeat(env: string, roomId: string, peerId: string, now: number): Promise<void>;
  remove(env: string, roomId: string, peerId: string): Promise<void>;
  roster(env: string, roomId: string, now: number): Promise<RosterEntry[]>;
  post(env: string, roomId: string, envelope: SignalEnvelope, now: number): Promise<void>;
  drain(env: string, roomId: string, peerId: string, now: number): Promise<SignalEnvelope[]>;
  readCloud(env: string, roomId: string): Promise<CloudPublic>;
  unlockCloud(env: string, roomId: string, verifier: string): Promise<CloudUnlocked | null>;
  appendCloud(env: string, roomId: string, update: string, verifier: string | null): Promise<CloudWriteResult>;
  compactCloud(
    env: string,
    roomId: string,
    expectedLength: number,
    snapshot: string,
    verifier: string | null,
  ): Promise<CloudWriteResult>;
  protectCloud(
    env: string,
    roomId: string,
    salt: string,
    verifier: string,
    snapshot: string,
    previousVerifier: string | null,
  ): Promise<boolean>;
  unprotectCloud(env: string, roomId: string, verifier: string, snapshot: string): Promise<boolean>;
  claimPath(env: string, roomId: string, slug: string): Promise<"ok" | "taken">;
  resolvePath(env: string, slug: string): Promise<string | null>;
}
