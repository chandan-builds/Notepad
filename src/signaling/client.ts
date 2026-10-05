import { decryptBody, encryptBody } from "@/signaling/crypto";
import {
  HEARTBEAT_MS,
  isSignalPayload,
  MAILBOX_POLL_MS,
  MAX_SIGNAL_BODY_CHARS,
  PEER_POLL_MS,
  type RosterEntry,
  type SignalPayload,
} from "@/types/signaling";

type SignalingHandlers = {
  onRoster: (roster: RosterEntry[]) => void;
  onSignal: (from: string, payload: SignalPayload) => void;
  onUp: () => void;
  onDown: () => void;
};

export class SignalingClient {
  private stopped = false;
  private running = false;
  private heartbeatTimer = 0;
  private peerTimer = 0;
  private mailboxTimer = 0;
  private mailboxOn = false;
  private seen = new Set<string>();
  private down = false;

  constructor(
    private readonly roomId: string,
    private readonly peerId: string,
    private readonly key: CryptoKey,
    private readonly handlers: SignalingHandlers,
  ) {}

  start(): void {
    if (this.stopped || this.running) return;
    this.running = true;
    void this.heartbeat();
    void this.pollPeers();
    this.heartbeatTimer = window.setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    this.peerTimer = window.setInterval(() => void this.pollPeers(), PEER_POLL_MS);
  }

  pause(): void {
    if (this.stopped || !this.running) return;
    this.running = false;
    window.clearInterval(this.heartbeatTimer);
    window.clearInterval(this.peerTimer);
    window.clearInterval(this.mailboxTimer);
    this.heartbeatTimer = 0;
    this.peerTimer = 0;
    this.mailboxTimer = 0;
    this.mailboxOn = false;
    this.leave();
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
    window.clearInterval(this.heartbeatTimer);
    window.clearInterval(this.peerTimer);
    window.clearInterval(this.mailboxTimer);
    this.leave();
  }

  refresh(): void {
    if (this.stopped || !this.running) return;
    void this.heartbeat();
    void this.pollPeers();
    if (this.mailboxOn) void this.pollMailbox();
  }

  setMailboxPolling(on: boolean): void {
    if (this.stopped || !this.running || on === this.mailboxOn) return;
    this.mailboxOn = on;
    window.clearInterval(this.mailboxTimer);
    this.mailboxTimer = 0;
    if (!on) return;
    void this.pollMailbox();
    this.mailboxTimer = window.setInterval(() => void this.pollMailbox(), MAILBOX_POLL_MS);
  }

  leave(): void {
    const url = `/api/rooms/${this.roomId}/presence?peerId=${encodeURIComponent(this.peerId)}`;
    void fetch(url, { method: "DELETE", keepalive: true, cache: "no-store" }).catch(() => undefined);
  }

  async post(to: string, payload: SignalPayload): Promise<void> {
    if (this.stopped || !this.running) return;
    try {
      const body = await encryptBody(this.key, JSON.stringify(payload));
      if (body.length > MAX_SIGNAL_BODY_CHARS) return;
      const response = await fetch(`/api/rooms/${this.roomId}/signal`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to,
          from: this.peerId,
          id: crypto.randomUUID(),
          body,
        }),
      });
      if (!response.ok) throw new Error("signal failed");
      this.markUp();
    } catch {
      this.markDown();
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.stopped || !this.running) return;
    try {
      const response = await fetch(`/api/rooms/${this.roomId}/presence`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ peerId: this.peerId }),
      });
      if (this.stopped || !this.running) return;
      if (!response.ok) throw new Error("presence failed");
      const data = (await response.json()) as { roster?: RosterEntry[] };
      if (Array.isArray(data.roster)) this.handlers.onRoster(data.roster);
      this.markUp();
    } catch {
      this.markDown();
    }
  }

  private async pollPeers(): Promise<void> {
    if (this.stopped || !this.running) return;
    try {
      const response = await fetch(
        `/api/rooms/${this.roomId}/peers?peerId=${encodeURIComponent(this.peerId)}`,
        { cache: "no-store" },
      );
      if (this.stopped || !this.running) return;
      if (!response.ok) throw new Error("peers failed");
      const data = (await response.json()) as { roster?: RosterEntry[] };
      if (Array.isArray(data.roster)) this.handlers.onRoster(data.roster);
      this.markUp();
    } catch {
      this.markDown();
    }
  }

  private async pollMailbox(): Promise<void> {
    if (this.stopped || !this.running || !this.mailboxOn) return;
    try {
      const response = await fetch(
        `/api/rooms/${this.roomId}/signal?peerId=${encodeURIComponent(this.peerId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("mailbox failed");
      const data = (await response.json()) as { messages?: Array<{ from: string; id: string; body: string }> };
      this.markUp();
      for (const message of data.messages ?? []) {
        if (!message?.id || this.seen.has(message.id)) continue;
        this.remember(message.id);
        const plain = await decryptBody(this.key, message.body);
        if (!plain) continue;
        let payload: unknown;
        try {
          payload = JSON.parse(plain);
        } catch {
          continue;
        }
        if (!isSignalPayload(payload)) continue;
        this.handlers.onSignal(message.from, payload);
      }
    } catch {
      this.markDown();
    }
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > 500) {
      const first = this.seen.values().next().value;
      if (first) this.seen.delete(first);
    }
  }

  private markUp(): void {
    if (!this.down) return;
    this.down = false;
    this.handlers.onUp();
  }

  private markDown(): void {
    if (this.down) return;
    this.down = true;
    this.handlers.onDown();
  }
}
