import { Awareness } from "y-protocols/awareness";
import type { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { SyncChannel } from "@/collaboration/sync-channel";
import { randomIdentity, type LocalIdentity } from "@/lib/identity";
import { detectWebRTC } from "@/lib/support";
import { openLocalDoc, wipeLocalDoc, type LocalDocStatus } from "@/persistence/local-doc";
import { deriveSignalingKey } from "@/signaling/crypto";
import { SignalingClient } from "@/signaling/client";
import { iceServers } from "@/webrtc/ice";
import { Mesh, type MeshSnapshot } from "@/webrtc/mesh";

export type BannerTone = "warn" | "info";

export type SessionBanner = {
  id: string;
  tone: BannerTone;
  text: string;
};

export type SessionPhase =
  | "opening"
  | "offline"
  | "local"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ice-failed"
  | "room-full"
  | "signaling";

export type SessionSnapshot = {
  ready: boolean;
  epoch: number;
  phase: SessionPhase;
  statusLabel: string;
  statusDetail: string;
  peerCount: number;
  banners: SessionBanner[];
  canShare: boolean;
  canRetry: boolean;
};

type Listener = () => void;

const OPENING: SessionSnapshot = {
  ready: false,
  epoch: 0,
  phase: "opening",
  statusLabel: "Opening",
  statusDetail: "Loading the copy on this device.",
  peerCount: 1,
  banners: [],
  canShare: false,
  canRetry: false,
};

export class CollaborationSession {
  private doc: Y.Doc;
  private awareness: Awareness;
  private persistence: Awaited<ReturnType<typeof openLocalDoc>>["persistence"];
  private storageStatus: LocalDocStatus;
  private mesh: Mesh | null;
  private signaling: SignalingClient | null;
  private readonly syncs = new Map<string, SyncChannel>();
  private readonly listeners = new Set<Listener>();
  private snapshot: SessionSnapshot = OPENING;
  private destroyed = false;
  private everConnected = false;
  private offline = false;
  private signalingDown = false;
  private storageBanner: SessionBanner | null = null;
  private deletedBanner = false;
  private readonly webrtc: boolean;
  private readonly onAwareness = () => this.publish();
  private readonly onOnline = () => {
    this.offline = false;
    this.signaling?.refresh();
    this.mesh?.reconnectStale();
    this.publish();
  };
  private readonly onOffline = () => {
    this.offline = true;
    this.publish();
  };
  private readonly onVisible = () => {
    if (document.visibilityState !== "visible") return;
    this.signaling?.refresh();
    this.mesh?.reconnectStale();
    this.publish();
  };
  private readonly onPageHide = () => {
    this.awareness.setLocalState(null);
    this.mesh?.close();
    this.signaling?.leave();
  };
  private readonly onPageShow = () => {
    this.signaling?.refresh();
    this.mesh?.reconnectStale();
    this.publish();
  };

  private constructor(
    doc: Y.Doc,
    awareness: Awareness,
    persistence: CollaborationSession["persistence"],
    storageStatus: LocalDocStatus,
    private readonly roomId: string,
    private readonly peerId: string,
    mesh: Mesh | null,
    signaling: SignalingClient | null,
    webrtc: boolean,
  ) {
    this.doc = doc;
    this.awareness = awareness;
    this.persistence = persistence;
    this.storageStatus = storageStatus;
    this.mesh = mesh;
    this.signaling = signaling;
    this.webrtc = webrtc;
    this.storageBanner = bannerForStorage(storageStatus);
    this.awareness.on("change", this.onAwareness);
    this.doc.on("update", this.onDocUpdate);
  }

  static async open(roomId: string, fragmentKey: string): Promise<CollaborationSession> {
    const peerId = crypto.randomUUID();
    const local = await openLocalDoc(roomId, new Y.Doc());
    const identity = await loadIdentity(local.persistence);
    const awareness = new Awareness(local.doc);
    awareness.setLocalStateField("user", identity);
    const webrtc = detectWebRTC();
    let mesh: Mesh | null = null;
    let signaling: SignalingClient | null = null;
    const session = new CollaborationSession(
      local.doc,
      awareness,
      local.persistence,
      local.status,
      roomId,
      peerId,
      null,
      null,
      webrtc,
    );
    if (webrtc) {
      const key = await deriveSignalingKey(fragmentKey, roomId);
      signaling = new SignalingClient(roomId, peerId, key, {
        onRoster: (roster) => {
          mesh?.setRoster(roster);
          signaling?.setMailboxPolling(mesh?.needsMailbox() ?? false);
          session.publish();
        },
        onSignal: (from, payload) => {
          mesh?.receive(from, payload);
          signaling?.setMailboxPolling(mesh?.needsMailbox() ?? false);
        },
        onUp: () => {
          session.signalingDown = false;
          session.publish();
        },
        onDown: () => {
          session.signalingDown = true;
          session.publish();
        },
      });
      mesh = new Mesh(peerId, iceServers(), {
        send: (to, payload) => void signaling?.post(to, payload),
        onChannel: (id, channel) => session.attachChannel(id, channel),
        onChannelClosed: (id) => session.detachChannel(id),
        onChange: () => {
          signaling?.setMailboxPolling(mesh?.needsMailbox() ?? false);
          session.publish();
        },
      });
      session.mesh = mesh;
      session.signaling = signaling;
    }
    session.publish();
    return session;
  }

  start(): void {
    if (this.destroyed) return;
    this.bindLifecycle();
    this.signaling?.start();
    this.signaling?.setMailboxPolling(this.mesh?.needsMailbox() ?? false);
    this.publish();
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  getAwareness(): Awareness {
    return this.awareness;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  retryConnections(): void {
    this.signaling?.refresh();
    this.mesh?.retryFailed();
    this.publish();
  }

  async deleteLocalCopy(): Promise<void> {
    if (this.destroyed) return;
    this.mesh?.close();
    for (const sync of this.syncs.values()) sync.destroy();
    this.syncs.clear();
    const previous = this.persistence;
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("change", this.onAwareness);
    this.awareness.destroy();
    await wipeLocalDoc(this.roomId, previous);
    const next = await openLocalDoc(this.roomId, new Y.Doc());
    this.doc = next.doc;
    this.persistence = next.persistence;
    this.storageStatus = next.status === "ok" ? "ok" : next.status;
    this.awareness = new Awareness(this.doc);
    const identity = await loadIdentity(this.persistence);
    this.awareness.setLocalStateField("user", identity);
    this.awareness.on("change", this.onAwareness);
    this.doc.on("update", this.onDocUpdate);
    this.deletedBanner = true;
    this.storageBanner = bannerForStorage(this.storageStatus);
    this.everConnected = false;
    this.publish();
    this.signaling?.refresh();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("pageshow", this.onPageShow);
    this.awareness.setLocalState(null);
    for (const sync of this.syncs.values()) sync.destroy();
    this.syncs.clear();
    this.mesh?.close();
    this.signaling?.stop();
    this.awareness.off("change", this.onAwareness);
    this.doc.off("update", this.onDocUpdate);
    this.awareness.destroy();
    void this.persistence?.destroy();
  }

  private bindLifecycle(): void {
    this.offline = typeof navigator !== "undefined" && navigator.onLine === false;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
  }

  private attachChannel(peerId: string, channel: RTCDataChannel): void {
    this.detachChannel(peerId);
    const sync = new SyncChannel(this.doc, this.awareness, channel);
    this.syncs.set(peerId, sync);
    this.everConnected = true;
    this.publish();
  }

  private detachChannel(peerId: string): void {
    const sync = this.syncs.get(peerId);
    if (!sync) return;
    sync.destroy();
    this.syncs.delete(peerId);
    this.publish();
  }

  private readonly onDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === this.persistence) return;
    if (this.deletedBanner && origin && origin !== this) {
      this.deletedBanner = false;
      this.publish();
    }
  };

  private publish(): void {
    if (this.destroyed) return;
    const mesh = this.mesh?.snapshot() ?? emptyMesh();
    if (mesh.openChannels > 0) this.everConnected = true;
    const phase = phaseFor(
      {
        offline: this.offline,
        webrtc: this.webrtc,
        signalingDown: this.signalingDown,
        everConnected: this.everConnected,
      },
      mesh,
    );
    const copy = copyFor(phase, this.peerCount(), this.signalingDown && mesh.openChannels > 0);
    const banners = this.banners(mesh, phase);
    this.snapshot = {
      ready: true,
      epoch: this.doc.clientID,
      phase,
      statusLabel: copy.label,
      statusDetail: copy.detail,
      peerCount: this.peerCount(),
      banners,
      canShare: true,
      canRetry: phase === "ice-failed" || phase === "signaling" || phase === "reconnecting",
    };
    for (const listener of this.listeners) listener();
  }

  private peerCount(): number {
    let count = 0;
    this.awareness.getStates().forEach((state) => {
      if (state != null) count += 1;
    });
    return Math.max(1, count);
  }

  private banners(mesh: MeshSnapshot, phase: SessionPhase): SessionBanner[] {
    const banners: SessionBanner[] = [];
    if (!this.webrtc) {
      banners.push({
        id: "webrtc",
        tone: "warn",
        text: "This browser can’t join live editing. You can still type on this device.",
      });
    }
    if (this.storageBanner) banners.push(this.storageBanner);
    if (this.deletedBanner) {
      banners.push({
        id: "deleted",
        tone: "info",
        text: "Deleted the copy on this device. Other devices keep theirs. If someone is online, their text can sync back.",
      });
    }
    if (mesh.roomFull) {
      banners.push({
        id: "room-full",
        tone: "warn",
        text: "This room is full. You can type locally; live sync stays off.",
      });
    }
    if (phase === "ice-failed") {
      banners.push({
        id: "ice",
        tone: "warn",
        text: "Couldn’t open a direct connection on this network. Changes stay on this device. A relay is not set up in this version.",
      });
    }
    if (this.signalingDown && mesh.openChannels > 0) {
      banners.push({
        id: "signaling",
        tone: "info",
        text: "Can’t reach the connection service. People already connected stay connected.",
      });
    }
    return banners;
  }
}

function emptyMesh(): MeshSnapshot {
  return { roomFull: false, remotePeers: 0, openChannels: 0, connecting: 0, failed: 0 };
}

function phaseFor(
  session: { offline: boolean; webrtc: boolean; signalingDown: boolean; everConnected: boolean },
  mesh: MeshSnapshot,
): SessionPhase {
  if (session.offline) return "offline";
  if (!session.webrtc) return "local";
  if (mesh.roomFull) return "room-full";
  if (mesh.openChannels > 0) return "connected";
  if (session.signalingDown && mesh.remotePeers === 0 && mesh.connecting === 0) return "signaling";
  if (mesh.failed > 0 && mesh.connecting === 0) return "ice-failed";
  if (session.signalingDown) return "signaling";
  if (mesh.remotePeers > 0 || mesh.connecting > 0) {
    return session.everConnected ? "reconnecting" : "connecting";
  }
  return "local";
}

function copyFor(
  phase: SessionPhase,
  peerCount: number,
  signalingWhileConnected: boolean,
): { label: string; detail: string } {
  const people = peerCount === 1 ? "1 person" : `${peerCount} people`;
  switch (phase) {
    case "offline":
      return { label: "Offline", detail: "Saved on this device." };
    case "signaling":
      return {
        label: "Reconnecting",
        detail: "Reconnecting to the connection service. You can keep typing.",
      };
    case "room-full":
      return {
        label: "On this device",
        detail: "Saved on this device. Others see your changes only while you are connected.",
      };
    case "ice-failed":
      return {
        label: "No direct path",
        detail: "Saved on this device. This network is blocking a direct connection.",
      };
    case "connected":
      return {
        label: "Connected",
        detail: signalingWhileConnected
          ? `${people} in this note. New people may have to wait for the connection service.`
          : `${people} in this note.`,
      };
    case "connecting":
      return { label: "Connecting", detail: "Looking for others with this link." };
    case "reconnecting":
      return { label: "Reconnecting", detail: "Trying the connection again." };
    default:
      return {
        label: "On this device",
        detail: "Saved on this device. Others see your changes while you are both online.",
      };
  }
}

function bannerForStorage(status: LocalDocStatus): SessionBanner | null {
  if (status === "unavailable") {
    return {
      id: "storage",
      tone: "warn",
      text: "This note will disappear if you refresh. This browser isn’t storing it.",
    };
  }
  if (status === "reset") {
    return {
      id: "reset",
      tone: "warn",
      text: "The copy on this device was reset. If someone else is online, their copy can fill it in.",
    };
  }
  return null;
}

async function loadIdentity(persistence: IndexeddbPersistence | null): Promise<LocalIdentity> {
  if (!persistence) return randomIdentity();
  await persistence.set("lastOpened", Date.now());
  const [name, color, colorLight] = await Promise.all([
    persistence.get("name"),
    persistence.get("color"),
    persistence.get("colorLight"),
  ]);
  if (typeof name === "string" && typeof color === "string" && typeof colorLight === "string") {
    return { name, color, colorLight };
  }
  const identity = randomIdentity();
  await persistence.set("name", identity.name);
  await persistence.set("color", identity.color);
  await persistence.set("colorLight", identity.colorLight);
  return identity;
}

export const openingSnapshot = OPENING;
