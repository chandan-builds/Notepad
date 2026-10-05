import type { RosterEntry, SignalPayload } from "@/types/signaling";
import { ROOM_PEER_CAP } from "@/types/signaling";
import { admitPeers } from "@/webrtc/admit";
import { PeerLink } from "@/webrtc/negotiate";

export type MeshSnapshot = {
  roomFull: boolean;
  remotePeers: number;
  openChannels: number;
  connecting: number;
  failed: number;
};

type MeshHooks = {
  send: (to: string, payload: SignalPayload) => void;
  onChannel: (peerId: string, channel: RTCDataChannel) => void;
  onChannelClosed: (peerId: string) => void;
  onChange: () => void;
};

export class Mesh {
  private links = new Map<string, PeerLink>();
  private remoteIds = new Set<string>();
  private lastRoster: RosterEntry[] = [];
  private paused = false;
  roomFull = false;

  constructor(
    private readonly localId: string,
    private readonly servers: RTCIceServer[],
    private readonly hooks: MeshHooks,
  ) {}

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.closeLinks();
      this.remoteIds = new Set();
      this.hooks.onChange();
      return;
    }
    this.setRoster(this.lastRoster);
  }

  setRoster(roster: RosterEntry[]): void {
    this.lastRoster = roster;
    if (this.paused) return;
    const admission = admitPeers(roster, this.localId, ROOM_PEER_CAP);
    this.roomFull = admission.roomFull;
    if (admission.roomFull) {
      this.closeLinks();
      this.remoteIds = new Set();
      this.hooks.onChange();
      return;
    }
    const next = new Set(admission.remoteIds);
    for (const id of next) {
      if (!this.links.has(id)) this.ensure(id);
    }
    for (const id of [...this.links.keys()]) {
      if (!next.has(id) && this.links.get(id)?.phase !== "open") this.drop(id);
    }
    this.remoteIds = next;
    this.hooks.onChange();
  }

  receive(from: string, payload: SignalPayload): void {
    if (this.paused || this.roomFull || from === this.localId) return;
    if (this.remoteIds.size > 0 && !this.remoteIds.has(from) && !this.links.has(from)) return;
    if (!this.links.has(from)) {
      if (this.links.size >= ROOM_PEER_CAP - 1) return;
      this.ensure(from);
    }
    void this.links.get(from)?.receive(payload);
  }

  needsMailbox(): boolean {
    if (this.roomFull) return false;
    if (this.links.size === 0) return true;
    for (const link of this.links.values()) {
      if (link.phase !== "open") return true;
    }
    return false;
  }

  reconnectStale(): void {
    if (this.paused || this.roomFull) return;
    if (this.links.size === 0 && this.lastRoster.length > 0) {
      this.setRoster(this.lastRoster);
      return;
    }
    for (const link of this.links.values()) {
      if (link.phase !== "open") link.retryNow();
    }
  }

  retryFailed(): void {
    this.reconnectStale();
  }

  snapshot(): MeshSnapshot {
    let openChannels = 0;
    let connecting = 0;
    let failed = 0;
    for (const link of this.links.values()) {
      if (link.phase === "open") openChannels += 1;
      else if (link.phase === "failed") failed += 1;
      else if (link.phase === "connecting") connecting += 1;
    }
    return {
      roomFull: this.roomFull,
      remotePeers: this.remoteIds.size,
      openChannels,
      connecting,
      failed,
    };
  }

  close(): void {
    this.closeLinks();
    this.remoteIds = new Set();
  }

  private ensure(peerId: string): void {
    if (this.links.has(peerId) || this.roomFull) return;
    const link = new PeerLink(this.localId, peerId, this.servers, {
      send: (payload) => this.hooks.send(peerId, payload),
      onChannel: (channel) => this.hooks.onChannel(peerId, channel),
      onChannelClosed: () => this.hooks.onChannelClosed(peerId),
      onState: () => this.hooks.onChange(),
    });
    this.links.set(peerId, link);
  }

  private drop(peerId: string): void {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    link.close();
    this.hooks.onChannelClosed(peerId);
  }

  private closeLinks(): void {
    for (const [peerId, link] of this.links) {
      link.close();
      this.hooks.onChannelClosed(peerId);
    }
    this.links.clear();
  }
}
