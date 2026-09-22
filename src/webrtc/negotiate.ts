import type { SignalPayload } from "@/types/signaling";

const DISCONNECT_GRACE_MS = 4_000;
const RESTART_WAIT_MS = 8_000;
const BACKOFF_CAP_MS = 15_000;

export type PeerPhase = "connecting" | "open" | "failed" | "closed";

export type PeerHooks = {
  send: (payload: SignalPayload) => void;
  onChannel: (channel: RTCDataChannel) => void;
  onChannelClosed: () => void;
  onState: () => void;
};

export class PeerLink {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private pendingCandidates: Array<RTCIceCandidateInit | null> = [];
  private readonly polite: boolean;
  private closed = false;
  private retiring = false;
  private announced = false;
  private attempt = 0;
  private replaceTimer: number | null = null;
  private disconnectTimer: number | null = null;
  private failed = false;

  constructor(
    localId: string,
    readonly remoteId: string,
    private readonly servers: RTCIceServer[],
    private readonly hooks: PeerHooks,
  ) {
    this.polite = localId < remoteId;
    this.open();
  }

  get phase(): PeerPhase {
    if (this.closed) return "closed";
    if (this.channel?.readyState === "open") return "open";
    if (this.failed) return "failed";
    return "connecting";
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.retiring = true;
    this.channel?.close();
    this.pc?.close();
    this.hooks.onState();
  }

  retryNow(): void {
    if (this.closed) return;
    this.attempt = 0;
    this.clearTimers();
    this.failed = true;
    this.replaceNow();
  }

  async receive(payload: SignalPayload): Promise<void> {
    const pc = this.pc;
    if (!pc || this.closed || pc.signalingState === "closed") return;
    try {
      if (payload.kind === "description") {
        await this.receiveDescription(pc, payload.description);
        return;
      }
      if (this.ignoreOffer) return;
      await this.addCandidate(payload.candidate);
    } catch {
      this.failed = true;
      this.hooks.onState();
    }
  }

  private open(): void {
    this.failed = false;
    this.announced = false;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false;
    this.pendingCandidates = [];
    this.channel = null;
    const pc = new RTCPeerConnection({ iceServers: this.servers });
    this.pc = pc;

    pc.onnegotiationneeded = async () => {
      if (this.pc !== pc || this.closed) return;
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.hooks.send({ kind: "description", description: pc.localDescription });
        }
      } catch {
        this.failed = true;
        this.hooks.onState();
      } finally {
        this.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (this.pc !== pc || this.closed) return;
      this.hooks.send({
        kind: "candidate",
        candidate: candidate ? candidate.toJSON() : null,
      });
    };

    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return;
      this.onIce(pc);
    };

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === "failed") {
        this.failed = true;
        this.scheduleReplace();
      }
      this.hooks.onState();
    };

    pc.ondatachannel = (event) => {
      if (this.pc !== pc) {
        event.channel.close();
        return;
      }
      this.acceptChannel(event.channel);
    };

    if (!this.polite) {
      this.acceptChannel(pc.createDataChannel("y-sync", { ordered: true }));
    }
    this.hooks.onState();
  }

  private async receiveDescription(
    pc: RTCPeerConnection,
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    const readyForOffer =
      !this.makingOffer && (pc.signalingState === "stable" || this.isSettingRemoteAnswerPending);
    const offerCollision = description.type === "offer" && !readyForOffer;
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;
    this.isSettingRemoteAnswerPending = description.type === "answer";
    await pc.setRemoteDescription(description);
    this.isSettingRemoteAnswerPending = false;
    if (description.type === "offer") {
      await pc.setLocalDescription();
      if (pc.localDescription) {
        this.hooks.send({ kind: "description", description: pc.localDescription });
      }
    }
    await this.flushCandidates();
  }

  private async addCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    if (!pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate ?? undefined);
    } catch {
      if (!this.ignoreOffer) this.hooks.onState();
    }
  }

  private async flushCandidates(): Promise<void> {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) await this.addCandidate(candidate);
  }

  private acceptChannel(channel: RTCDataChannel): void {
    if (channel.label !== "y-sync") {
      channel.close();
      return;
    }
    if (this.channel && this.channel !== channel) {
      const currentOpen = this.channel.readyState === "open";
      const keepCurrent = currentOpen || (!this.polite && this.channel.readyState !== "closed");
      if (keepCurrent) {
        channel.close();
        return;
      }
      this.channel.close();
    }
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      if (this.channel !== channel) return;
      this.attempt = 0;
      this.failed = false;
      this.announce(channel);
      this.hooks.onState();
    };
    channel.onclose = () => {
      if (this.retiring || this.closed || this.channel !== channel) return;
      this.hooks.onChannelClosed();
      this.failed = true;
      this.scheduleReplace();
    };
    if (channel.readyState === "open") this.announce(channel);
  }

  private announce(channel: RTCDataChannel): void {
    if (this.announced || channel.readyState !== "open") return;
    this.announced = true;
    this.hooks.onChannel(channel);
  }

  private onIce(pc: RTCPeerConnection): void {
    const state = pc.iceConnectionState;
    if (state === "connected" || state === "completed") {
      this.attempt = 0;
      this.failed = false;
      this.clearDisconnectTimer();
      this.hooks.onState();
      return;
    }
    if (state === "disconnected") {
      this.clearDisconnectTimer();
      this.disconnectTimer = window.setTimeout(() => {
        if (this.closed || this.pc !== pc) return;
        const current = pc.iceConnectionState;
        if (current === "disconnected" || current === "failed") this.repairOrReplace(pc);
      }, DISCONNECT_GRACE_MS);
      this.hooks.onState();
      return;
    }
    if (state === "failed") {
      this.failed = true;
      this.hooks.onState();
      this.scheduleReplace();
    }
  }

  private repairOrReplace(pc: RTCPeerConnection): void {
    if (pc.connectionState === "closed" || pc.signalingState === "closed") {
      this.scheduleReplace();
      return;
    }
    try {
      pc.restartIce();
      this.clearDisconnectTimer();
      this.disconnectTimer = window.setTimeout(() => {
        if (this.closed || this.pc !== pc) return;
        const state = pc.iceConnectionState;
        if (state !== "connected" && state !== "completed") {
          this.failed = true;
          this.scheduleReplace();
        }
      }, RESTART_WAIT_MS);
    } catch {
      this.scheduleReplace();
    }
  }

  private scheduleReplace(): void {
    if (this.closed || this.replaceTimer !== null) return;
    const delay = Math.min(BACKOFF_CAP_MS, 1000 * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 4);
    this.failed = true;
    this.hooks.onState();
    this.replaceTimer = window.setTimeout(() => {
      this.replaceTimer = null;
      this.replaceNow();
    }, delay);
  }

  private replaceNow(): void {
    if (this.closed) return;
    this.retiring = true;
    this.hooks.onChannelClosed();
    this.channel?.close();
    this.pc?.close();
    this.retiring = false;
    this.open();
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer !== null) {
      window.clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearDisconnectTimer();
    if (this.replaceTimer !== null) {
      window.clearTimeout(this.replaceTimer);
      this.replaceTimer = null;
    }
  }
}
