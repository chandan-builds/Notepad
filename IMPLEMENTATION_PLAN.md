# Real-Time P2P Collaborative Notepad — Implementation Plan

Status: architecture plan only. No application code until this plan is approved.

Date of documentation review: 22 September 2026.

Primary sources checked:

- [Vercel Functions WebSockets](https://vercel.com/docs/functions/websockets) (public beta; changelog 22 June 2026)
- [Vercel Functions limits and Fluid compute](https://vercel.com/docs/functions/limitations)
- [`@vercel/functions` `experimental_upgradeWebSocket`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- [Publish and subscribe to realtime data on Vercel](https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel)
- [Yjs document updates](https://docs.yjs.dev/api/document-updates)
- [Yjs introduction and editor guide](https://docs.yjs.dev/)
- [y-indexeddb documentation](https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb) and current `src/y-indexeddb.js`
- [y-webrtc source](https://github.com/yjs/y-webrtc) (`simple-peer`, WebSocket signaling, `y-protocols`)
- [y-codemirror.next 0.3.6](https://www.npmjs.com/package/y-codemirror.next) (published 18 August 2026, peer `yjs` ^13.5.6)
- [MDN RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection) (Baseline, widely available since September 2017)
- [MDN RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel) (Baseline since January 2020)
- [MDN perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
- [MDN Using data channels](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels)
- [RFC 8831 WebRTC Data Channels](https://www.rfc-editor.org/rfc/rfc8831.html)
- [Cloudflare STUN and TURN](https://developers.cloudflare.com/realtime/turn/)

---

## 0. Architectural correction (read this first)

The stack in the brief is right about the product: Next.js on Vercel, Yjs in the browser, WebRTC DataChannels for document bytes, IndexedDB for local persistence, and no document database.

Two parts of the proposed signaling design are incompatible with current platform behavior. They should be changed before any code is written.

### Correction 1 — In-memory Vercel WebSockets cannot be the signaling room

Vercel Functions can serve WebSockets. That support is **public beta**, requires Fluid compute (default for projects created on or after 23 April 2025), and has these documented constraints:

- A socket is pinned to the one Function instance that accepted the upgrade.
- A later connection, including the second user in the same room, is **not** guaranteed to reach that same instance.
- After a deployment, new sockets can land on the new deployment while old sockets stay on the previous one until they close.
- The socket is closed when the Function hits its maximum duration. With Fluid compute that cap is **300 seconds on Hobby** (also the maximum). Pro and Enterprise default to 300 seconds, can be raised to 800 seconds, and have a 1,800-second extended maximum that is still in beta.
- Vercel’s own guidance: rooms, presence, and pub/sub must live in an external store such as Redis from the Vercel Marketplace. Module-level memory works on one local Node process and fails across instances.
- Next.js has no native WebSocket upgrade API. The supported workaround is the experimental `experimental_upgradeWebSocket()` helper from `@vercel/functions`. Vercel documents that this helper only behaves as a platform WebSocket on Vercel, and that it gives less control over the request lifecycle than a native Node server.

A signaling process that keeps the room roster in a JavaScript `Map` will work in `next dev` and will fail in production as soon as two browsers hit different instances, or as soon as a socket is killed at the duration limit.

WebSockets also do not match this workload. Signaling traffic is a short burst of SDP and ICE messages at connect and reconnect time. The notepad session after that can last hours. Holding a Function open for the whole session pays provisioned-memory time, dies at the duration cap, and still needs Redis to fan messages across instances.

**Signaling for this project is a set of short Next.js route handlers on the same Vercel project, plus a Redis mailbox used only for peer discovery and encrypted SDP/ICE.** Document bytes never enter that mailbox.

### Correction 2 — Do not adopt the `y-webrtc` package

`y-webrtc` is the official Yjs WebRTC connector, and its sync framing (`y-protocols`) is the right protocol. The package itself is the wrong integration:

- It speaks to a long-lived WebSocket signaling server (`subscribe` / `publish` / `announce`). The current source defaults to `wss://y-webrtc-eu.fly.dev`. The published README still lists older public servers. Either way, the signaling server is a third-party process with in-memory topics, which is the architecture Vercel does not provide.
- It creates peer connections through `simple-peer` rather than `RTCPeerConnection`.
- The npm release `10.3.0` was published on 28 December 2023. The GitHub default branch has moved since that release. Depending on it means depending on an unmaintained integration boundary.

Use **Yjs 13**, **`y-protocols`** (sync + awareness), and the **browser WebRTC API** directly. That is the same protocol `y-webrtc` uses, aimed at a signaling transport that can actually run on Vercel.

Yjs’s own editor guide describes `y-webrtc` as a good demo provider and says a real-world app usually syncs the document to a server. This product deliberately does not do that. The consequence is a product limitation, not a bug: **if every browser that holds the note is closed and its site data is cleared, the note is gone.** There is no cloud copy. Section 12 states the user-visible consequences.

### Correction 3 — TURN is real, and it is not in the MVP path

Direct peer connectivity is not guaranteed. STUN discovers public addresses. TURN relays bytes when NAT or a firewall blocks a direct path. A STUN-only MVP is acceptable only if ICE failure is a first-class, explained state. Shipping a silent “Connected” that never connects on some networks is not acceptable.

### What stays from the original brief

Next.js, React, TypeScript, Yjs, WebRTC DataChannels, IndexedDB, Vercel, no document database, no Firebase, no Supabase, no MongoDB, no PostgreSQL, and no separate VPS. Redis is introduced for one documented reason: Vercel requires shared state for cross-instance coordination, and peer discovery is impossible without it. Redis stores peer ids and encrypted signaling envelopes with short TTLs. It is not a document store.

---

## 1. Project Understanding

Two or more browsers open the same secret link and edit one plain-text note. Each keystroke becomes a small Yjs update. That update is stored in IndexedDB on the editing browser and sent to the other browsers over a WebRTC DataChannel. Yjs merges concurrent edits so both browsers converge on the same text. The Vercel app serves the UI and a short-lived signaling API that helps browsers find each other and exchange connection information. After the DataChannel is open, the note itself does not travel through Vercel.

The product feels like a small shared notepad. It is not a full document suite. It has no accounts, no server history, and no rich text in version 1.

The hard part is not the editor. The hard part is making the rendezvous reliable on Vercel’s serverless model, and being honest about networks where a direct peer connection cannot be formed.

---

## 2. Requirements

### Functional requirements

MVP:

- Create a note and land on a shareable URL.
- Open that URL in another browser and join the same note.
- Type in either browser and see the other browser update immediately while both are connected.
- Allow both people to type at the same time without losing either person’s characters.
- Keep the note on the device across refresh and browser restart.
- Allow a person to edit while offline, then merge when a peer is reachable again.
- Leave and come back later, merging with whoever is currently online and still has the note.
- Show connection status, a peer count, and a Share action that copies the full secret URL.
- Show a clear failure when the browsers cannot open a direct connection.
- Reject malformed links.
- Work for 2 people, and keep working up to a hard cap of 8 people in one room.

Explicitly out of MVP (see section 12): accounts, permissions, rich text, comments, server-side history, TURN relay, and mobile-app shells.

### Technical requirements

- Deploy with `npm install` and `npm run build` to Vercel. No second server, VPS, or container.
- Run the editor, Yjs document, persistence, and WebRTC in the browser.
- Run only signaling routes on Vercel Functions.
- Synchronize document state with Yjs updates (state vectors and incremental updates), never by posting the whole note on each keystroke.
- Persist the Yjs document in IndexedDB with `y-indexeddb`.
- Use a full mesh of DataChannels for rooms of 2–8 peers.
- Use STUN only in MVP. Structure ICE server configuration so TURN can be added later without rewriting peer setup.
- Keep the fragment secret out of Vercel requests, logs, and Redis.
- Detect missing WebRTC support and missing IndexedDB.

### Non-functional requirements

- Correctness and reconnection behavior come before visual design.
- A two-person same-network session should reach “connected” within a few seconds once both tabs are open.
- Typing latency after the DataChannel is open should be on the order of a network round trip, not a server poll interval.
- The UI remains usable when the user is alone, offline, or unable to traverse NAT.
- Dependencies stay limited to Next.js, React, Yjs 13, `y-protocols`, `y-indexeddb`, CodeMirror 6, `y-codemirror.next`, and `@upstash/redis`.
- No Redux, Zustand, Jotai, Socket.IO, `y-webrtc`, `y-websocket`, or `simple-peer`.

---

## 3. Proposed Architecture

```text
                         Vercel project (one Next.js app)
        ┌──────────────────────────────────────────────────────────┐
        │  Static / server-rendered UI                            │
        │  /                         create a note                 │
        │  /n/[roomId]               notepad (client)              │
        │                                                          │
        │  Route handlers (short requests, Node runtime)          │
        │  POST/GET  /api/rooms/[roomId]/presence                 │
        │  GET       /api/rooms/[roomId]/peers                    │
        │  POST/GET  /api/rooms/[roomId]/signal                   │
        └────────────┬───────────────────────────────┬─────────────┘
                     │ presence + encrypted SDP/ICE  │
                     ▼                               ▼
              Upstash Redis                    Upstash Redis
              peer roster (TTL)                per-peer mailbox (TTL)
                     ▲                               ▲
                     │ HTTPS, no document bytes      │
     ┌───────────────┴───────────┐   ┌──────────────┴────────────────┐
     │ Browser A                 │   │ Browser B                     │
     │ CodeMirror 6              │   │ CodeMirror 6                  │
     │ Y.Doc + Y.Text            │   │ Y.Doc + Y.Text                │
     │ y-indexeddb               │   │ y-indexeddb                   │
     │ RTCPeerConnection         │   │ RTCPeerConnection             │
     └────────────┬──────────────┘   └──────────────┬────────────────┘
                  │                                  │
                  │   STUN (address discovery only)  │
                  │   stun.cloudflare.com:3478       │
                  │                                  │
                  └──────── WebRTC DataChannel ──────┘
                         DTLS + SCTP
                         Yjs sync + awareness
                         (the actual note)
```

Direct path, which is the MVP success case:

```text
Browser A ────────────────────────────── Browser B
           DataChannel, DTLS encrypted
```

Relay path, which is production work, not MVP:

```text
Browser A ──── TURN (ciphertext) ──── Browser B
```

What is intentionally absent: a document database, a Yjs websocket server, and an in-memory signaling process.

### Runtime split

| Concern | Where it runs |
| --- | --- |
| UI, editor, Y.Doc, CRDT merge | Browser |
| Document bytes | Browser to browser, DataChannel |
| Local durability | IndexedDB |
| Peer roster and SDP/ICE mailbox | Vercel route handlers + Redis |
| Address discovery | Public STUN |
| Accounts, document DB, history | Nowhere in v1 |

### Signaling shape

Redis is reached only from route handlers, using the Upstash REST client. There is no long-lived Redis connection and no blocking `XREAD`, because there is no long-lived socket to wake up.

Keys, all prefixed with `VERCEL_ENV` so preview deployments do not share a roster with production:

- `sig:{env}:{roomId}:peers` — sorted set, member = `peerId`, score = expiry timestamp.
- `sig:{env}:{roomId}:mbox:{peerId}` — list of encrypted envelopes addressed to that peer. Capped (about 50) and expired (about 120 seconds).

Route behavior:

- `POST presence` refreshes this tab’s `peerId` with a ~30 second expiry.
- `GET peers` returns other peer ids whose expiry is still in the future, and drops expired members.
- `POST signal` appends one encrypted envelope `{to, from, id, body}` where `body` is opaque ciphertext.
- `GET signal` returns and clears this peer’s mailbox.

The browser polls peers about every 15 seconds while the tab is open, so a late joiner can still find people who are already editing. It polls the mailbox about once a second only while it is trying to open or repair a peer connection. After every DataChannel in the room is open, mailbox polling stops. Presence continues.

An in-memory store implementing the same interface exists for `next dev` when Redis environment variables are absent. Production must refuse to boot the signaling routes if Redis is not configured. Falling back to process memory on Vercel would recreate the bug this plan is correcting.

---

## 4. Technology Decisions

### Next.js

Needed to deploy the UI and the signaling routes as one Vercel project.

Alternatives: a static Vite site (cannot rendezvous peers), a standalone Node server (forbidden by the deployment constraint), Remix or SvelteKit (no benefit here).

Use the current stable App Router release pinned by `create-next-app` at implementation time. Do not set `output: 'export'`. A fully static export cannot host the signaling routes. Route handlers run on the Node.js runtime. Fluid compute stays at the project default.

Signaling routes set a small `maxDuration` (10 seconds is enough). They do not need the 300-second socket window.

### React

Needed because it is the Next.js UI runtime. The editor itself is a CodeMirror view mounted from a client component. React does not own the document text.

### TypeScript

Needed for the signaling message contracts, peer state machine, and session boundaries. The interesting bugs in this project are state-machine bugs. Types pay for themselves there.

### Yjs 13

Needed because concurrent edits must converge without a central merge server.

Why Yjs fits this product, in the terms of the current document-updates documentation:

- A `Y.Doc` is a container of shared types. This app uses one shared type: `ydoc.getText("body")`, a `Y.Text`.
- Local edits are encoded as binary updates. An update is commutative, associative, and idempotent. Peers may apply updates in any order, more than once, and still converge once each peer has received the same set of updates.
- `ydoc.on("update", ...)` emits each incremental update. That is the unit sent over the DataChannel. It is a diff, not a snapshot of the whole note.
- `Y.encodeStateVector(doc)` describes what this peer already has.
- `Y.encodeStateAsUpdate(doc, remoteStateVector)` produces only the updates the remote peer is missing. The first connection may transfer a larger blob because the remote peer is empty. Later keystrokes transfer a small update.
- Conflict handling is inside the CRDT. Two people inserting at the same position both keep their characters. Every peer orders those concurrent inserts the same way. A delete racing an insert resolves the same way on every peer. There is no last-write-wins pass and no server referee.
- Transaction `origin` is how a provider ignores its own echoed updates. Remote updates are applied with `Y.applyUpdate(doc, update, provider)` so the network handler does not send them back out. `y-indexeddb` uses the same origin check.

Alternatives:

- Operational transform needs a central server to order operations. That is a document backend. Rejected.
- Automerge is a credible CRDT. Its editor bindings and IndexedDB story are heavier than Yjs for this notepad, and the CodeMirror binding we would use is a Yjs binding. Rejected for MVP.
- Shipping the full textarea value on every keystroke races and drops characters. Rejected by the brief and by the CRDT choice.

Stay on Yjs 13. The CodeMirror binding’s `main` branch targets an unstable Yjs 14 line (`@y/y`, `@y/codemirror`). The published `y-codemirror.next@0.3.6` targets Yjs 13. Use the published package.

### WebRTC DataChannel

Needed because it is the browser API that carries arbitrary bytes between two browsers after a handshake, with mandatory DTLS.

How a connection is built:

1. Each tab generates a random `peerId` (UUID) for that page load.
2. Presence heartbeat publishes `peerId` into the room roster.
3. The tab compares ids with each remote peer. The lexicographically smaller id is the polite peer. The larger id is the impolite peer (MDN perfect negotiation).
4. Both sides construct `new RTCPeerConnection({ iceServers })`. MVP `iceServers` is STUN only.
5. The impolite peer calls `createDataChannel("y-sync", { ordered: true })`. Ordered and reliable is the default and is what we want: Yjs tolerates reordering, but a reliable channel avoids having to invent our own retransmission. The polite peer waits for the `datachannel` event. One channel per pair, not two.
6. `negotiationneeded` leads to `setLocalDescription()` and a POST of the SDP offer.
7. `icecandidate` trickles each candidate, including the terminal `null` candidate, through the mailbox.
8. The other side applies `setRemoteDescription`, answers, and trickles its candidates. `addIceCandidate` is buffered until the remote description exists.
9. Perfect negotiation handles glare: if both sides offer at once, the polite peer rolls back and accepts the incoming offer; the impolite peer ignores the colliding offer. This matters on reconnect, when either side may restart.
10. When `RTCDataChannel.readyState` becomes `open`, the channel carries Yjs bytes and signaling polling for that pair stops.
11. `iceConnectionState` of `failed`, or `disconnected` that does not recover within a few seconds, closes that peer connection and starts a new handshake with backoff (1s, 2s, 4s, capped at 15s). `restartIce()` is used when the connection is still repairable; a new `RTCPeerConnection` is used when it is not.
12. Duplicate connections to the same `peerId` are closed. The survivor is the connection whose DataChannel is already `open`, otherwise the connection created by the impolite peer.
13. `beforeunload` and `pagehide` remove local awareness and close peer connections. `visibilitychange` back to visible, and the browser `online` event, check channel state and reconnect if the tab was suspended.
14. `bufferedAmount` is watched. Keystroke updates are queued while the buffer is high. If the queue grows too far, it is dropped and replaced by a fresh sync step 1 when the channel drains. Idempotent updates make that safe.

`binaryType` is `arraybuffer`.

Messages are framed the same way Yjs providers frame them, using `y-protocols` and `lib0` encoding:

- byte type `0`: sync message (`writeSyncStep1`, `readSyncMessage`, `writeUpdate`)
- byte type `1`: awareness update
- byte type `3`: awareness query

On channel open, the peer sends sync step 1 and its local awareness state. Sync step 1 carries the state vector. The receiver replies with sync step 2, which is `encode` of only the missing updates. After that, each local `Y.Doc` `update` event is forwarded with `writeUpdate`. Applying a remote update uses the provider as origin so it is not echoed.

If a single encoded message is larger than a conservative 16 KB chunk (the SDP default when `max-message-size` is absent is 64 KB, per MDN), the channel layer splits and reassembles it before `readSyncMessage`. A large initial sync of a long note is the case that hits this. A normal keystroke does not.

Browser support, from MDN and current Can I use data: `RTCDataChannel` is Baseline and widely available since January 2020, including current Chrome, Edge, Firefox, Safari, iOS Safari, and Chrome for Android. Internet Explorer has no support. The client checks for `RTCPeerConnection` and `createDataChannel` before enabling the editor’s network path. Local editing can still be offered if IndexedDB works.

Security properties of the channel are in section 10. Short version: DTLS is mandatory and automatic. The application does not configure it and cannot turn it off.

### IndexedDB and `y-indexeddb`

Needed so refresh and offline editing do not depend on a server copy.

`new IndexeddbPersistence(roomId, ydoc)` is the official provider. The database name is the room id. The fragment secret is not used as a database name.

Current provider behavior, from `y-indexeddb` source:

- Opens an IndexedDB database with two object stores: `updates` (auto-increment) and `custom`.
- On open, reads every stored update and applies it inside a transaction whose origin is the provider, then emits `synced`. The event also fires when the database is empty.
- Subscribes to `doc.on("update")` and writes each update immediately, skipping updates whose origin is the provider itself.
- When the stored update count reaches `PREFERRED_TRIM_SIZE` (500), it waits 1 second and compacts: writes one `Y.encodeStateAsUpdate(doc)` and deletes the older keys.
- `set` / `get` / `del` use the `custom` store. Those values stay on this browser. They are not part of the Yjs sync.
- `clearData()` deletes the database. `destroy()` closes it. Individual updates are already written before compaction, so a refresh during the compaction debounce does not lose keystrokes.

Local metadata in `custom`: display color, and the time the note was last opened. Nothing else.

Failure handling: if IndexedDB cannot be opened (private mode, quota, disabled storage), the session continues with an in-memory `Y.Doc` and a persistent banner that refresh will discard the note. If loading throws or the document fails to parse, the session calls `clearData()`, starts an empty document, and tells the user the local copy was reset. Remote peers can still supply their copy if they connect.

Cleanup: there is no server room to delete. The UI can offer “Delete local copy”, which calls `clearData()`. That does not delete the note from other browsers. A future improvement can garbage-collect IndexedDB databases whose `custom` last-opened time is old. Not required for MVP.

What is stored on the device:

```text
IndexedDB database = roomId
├── updates/     Yjs update blobs, compacted toward a single state blob
└── custom/      color, last opened (local only)
```

What is never stored on Vercel or in Redis: note text, Yjs updates, the URL fragment secret, cursor positions, or undo history.

### Vercel

Needed as the only hosting target. It serves the Next.js app and the signaling routes. It is not the document store.

Documented limits that matter here:

- Function body size 4.5 MB. Signaling envelopes are capped by our own code at 32 KB, far under that, so the mailbox cannot be used as a document dump.
- Hobby duration cap 300 seconds. Irrelevant for short route handlers. It is the reason not to hold a signaling socket open.
- Fluid compute on by default for new projects.
- WebSockets exist, are beta, and are the wrong tool for this signaling pattern (section 0).

### Signaling transport

Chosen: HTTPS route handlers + Redis mailbox.

Why it is appropriate:

- Both peers can rendezvous even when Vercel places them on different instances and different deployments.
- Messages survive the 300-second Function cap because nothing is held open.
- `next dev` exercises the same routes. WebSocket upgrade in Next.js does not.
- ICE trickle adds about one poll interval (target 1 second) to connection setup. That delay is acceptable for handshake. It is not on the typing path. Typing goes through the DataChannel.
- Upstash’s HTTP Redis client matches short Functions. A blocking TCP subscription would be the WebSocket-fanout design, which we are not building.

Rejected for MVP:

- In-memory WebSocket rooms. Incorrect on Vercel, as documented above.
- WebSocket plus Redis. Works, and Vercel’s chat samples do this, but it adds beta APIs, duration caps, reconnect storms, and a blocking Redis read for a handshake that HTTP already solves. Revisit only if handshake latency becomes a measured problem.
- Public `y-webrtc` signaling servers. Third-party availability, and the same long-lived socket assumption.
- `y-websocket` to a Yjs backend. That would move document bytes onto a server and violate the product goal.

### STUN and TURN

STUN answers “what public address does this peer appear to have?” ICE tries candidate pairs (host, then server-reflexive from STUN) and picks a working path. When no pair works, ICE fails. TURN allocates a relay address and carries the already-encrypted DTLS packets between the peers.

MVP ICE servers:

- `stun:stun.cloudflare.com:3478` — Cloudflare documents this STUN endpoint as free and unlimited.
- `stun:stun.l.google.com:19302` — widely used fallback if one STUN host is unreachable.

No TURN URLs in MVP. No TURN credentials in the client bundle.

Direct P2P usually succeeds on the same LAN, on many home NATs, and often over IPv6. It fails often enough to plan for it: symmetric NAT against symmetric NAT, and networks that block UDP. Corporate networks and some mobile carriers are the typical cases. The plan does not invent a failure percentage. The UI treats failure as normal.

Production follow-up, designed but not built in MVP:

- A route `POST /api/turn-credential` calls Cloudflare Realtime’s credential API with a server-side token and returns short-lived `iceServers`. Cloudflare documents that TURN credentials must be minted with a TTL; the long-term key is not a client credential. Filter out port 53 URLs; browsers block them.
- Cloudflare’s current pricing: TURN is free when bundled with their SFU, otherwise billed per egress gigabyte. A notepad relays very little text, but the relay is still a third-party path and a paid dependency.
- The client calls `pc.setConfiguration` to refresh credentials before they expire.
- `iceTransportPolicy: "relay"` is a debug switch only. Forcing relay would hide whether direct P2P works.

TURN trade-off, so the choice stays explicit: with TURN, document bytes still use DTLS, and Cloudflare’s own TURN FAQ states they relay ciphertext and see IP addresses, ports, and timing, not DataChannel contents. The path is no longer direct. That is why TURN is production connectivity insurance, not the MVP data plane.

### Editor

Chosen: CodeMirror 6 with `y-codemirror.next@0.3.6` and a `Y.Text` named `body`.

The binding maps CodeMirror transactions to `Y.Text` inserts and deletes, maps remote Yjs changes back into CodeMirror without resetting the textarea, renders remote selections from Yjs Awareness, and supports `Y.UndoManager` so undo reverts this user’s edits.

Configuration for MVP: one plain-text document, line wrapping, a monospace or system font, no language syntax package, no toolbar. Placeholder: “Start typing…”.

Evaluation:

| Option | Yjs fit | Concurrent editing | Mobile | Why it lands where it does |
| --- | --- | --- | --- | --- |
| `textarea` | No maintained binding | Cursor and selection jump; easy to clobber text | Good | Too weak for concurrent edits |
| `contenteditable` | Would require a custom binding | Browser inconsistencies | Fair | A custom binding is a second project |
| Monaco | `y-monaco` exists | Good | Poor, large bundle | A code IDE for a notepad |
| Tiptap / ProseMirror | First-class, actively used with Yjs | Excellent | Good | Rich text we are not building |
| Quill | Official tutorial path | Good | Fair | Rich text, older stack |
| CodeMirror 6 | `y-codemirror.next`, updated August 2026 | Built for this | Good | Chosen |

Remote carets are included in MVP because the binding already provides them and they make simultaneous editing understandable. They are awareness data on the DataChannel, not a second product.

Per-user undo is included. Shared undo (one history for the room) is the wrong behavior and is not built.

### Redis (Upstash)

Needed because peer discovery and the SDP mailbox must be visible to every Function instance. Vercel documents this requirement for rooms and pub/sub.

Alternatives considered: Vercel Blob (wrong latency and API for a mailbox), Edge Config (read-optimized, not a per-handshake log), Vercel KV-style Redis from the Marketplace (this is that category; Upstash is the concrete client), and no store at all (cannot rendezvous).

Redis holds ciphertext and peer ids for seconds to minutes. It is not queried for document contents because it does not have them.

### State management

React state plus a `CollaborationSession` class is enough.

- `Y.Doc` is the note.
- The session class holds peer connections, signaling status, and awareness.
- React subscribes with `useSyncExternalStore` for status text, peer count, banners, and the Share button.
- CodeMirror subscribes to `Y.Text` through `yCollab`, not through React state. Putting the note string in `useState` would fight the editor.

Redux, Zustand, and Jotai would add a store that mirrors state already owned by Yjs and the session class. They are not used.

---

## 5. Data Flow

The shareable URL is:

```text
https://<deployment>/n/<roomId>#<key>
```

- `roomId`: 16 random bytes, base64url, 22 characters. Collision resistance is the size of the id, not a server registry. There is no room table to collide with.
- `key`: another 16 random bytes, base64url, in the URL fragment.
- Browsers do not send fragments to servers. Route handlers, Vercel access logs, and Redis see `roomId` and never see `key`.
- The client derives an AES-GCM key from the fragment with HKDF (Web Crypto) and encrypts every signaling body before POST. A peer without the fragment cannot read offers and cannot produce envelopes the other peer will accept. Decrypt failures are ignored.
- A room id that does not match the 22-character base64url pattern renders an invalid-link page and does not open a document.
- A well-formed room id with no fragment renders a page that asks for the full link and does not open a document.
- There is no “room not found” server check. Any well-formed id is a note. The note is empty until this browser’s IndexedDB or a connected peer has content.

### 1. User creates a note

The home page draws `roomId` and `key` with `crypto.getRandomValues`, then navigates to `/n/{roomId}#{key}`. The notepad page reads both, constructs `Y.Doc`, attaches `IndexeddbPersistence`, and mounts CodeMirror on `Y.Text("body")`. IndexedDB `synced` fires with an empty database. The status is “On this device” with 1 user. No signaling message contains text.

### 2. User shares it

Share copies `window.location.href`, fragment included, to the clipboard. The button explains that anyone with the full link can edit. The fragment is the access secret.

### 3. Second user joins

Browser B opens the URL. It loads IndexedDB (empty on a new device), starts a presence heartbeat, and polls the peer list. Browser A is already heartbeating, so B learns A’s `peerId`. A learns B’s on its next peer poll (within about 15 seconds; the joiner also triggers an immediate peer fetch, and the joiner’s presence POST is enough for A’s next poll). Neither browser receives document bytes from Vercel.

### 4. Connection is established

The impolite peer creates the DataChannel, which fires negotiation. Offer, answer, and ICE candidates move through the encrypted mailbox. STUN is contacted by the browsers directly; those packets do not go through Vercel. ICE nominates a candidate pair. The DataChannel opens. Both sides send sync step 1. If A already typed, A’s sync step 2 carries the missing Yjs updates and B’s editor fills in. Mailbox polling for that pair stops. Status becomes “Connected”.

### 5. User A types

CodeMirror applies a transaction. `yCollab` inserts into `Y.Text` inside a Yjs transaction. `Y.Doc` emits one binary update. `y-indexeddb` writes it to the `updates` store. The session sends a sync `writeUpdate` frame on each open DataChannel whose origin is local. Browser B applies it with the provider origin, so B does not echo it. B’s CodeMirror binding inserts the same characters at the CRDT position and preserves B’s cursor. B’s IndexedDB stores the applied update.

### 6. User B types

The same path in the other direction.

### 7. Both users type at the same time

Each browser produces updates with its own Yjs client id and lamport-style item clocks. Both updates travel both ways (A’s update is already local on A; B sends B’s update to A, and the reverse). Each side applies the remote update. Because updates are commutative and idempotent, both documents contain both insertions. Concurrent inserts at one position are ordered identically on both peers by the CRDT, so the strings match. The CodeMirror binding moves each user’s selection according to the remote change. Neither client sends a full document snapshot.

### 8. A user disconnects

The DataChannel closes, or ICE enters `failed`. The remaining peer removes that connection, drops the peer from the count, and keeps the note locally. Awareness for the departed client expires (the protocol’s timeout is 30 seconds; `beforeunload` also clears it when the browser actually fires the event). Presence in Redis expires within about 30 seconds of the last heartbeat, so a departed tab disappears from the roster without a cron job. The note is not deleted anywhere, because the server never had it.

### 9. A user reconnects

The returning browser loads IndexedDB first, so the editor shows the local note immediately. It heartbeats presence, discovers current peers, and opens new peer connections. Sync step 1 / step 2 exchanges only the missing updates. Edits made offline on either side both survive and merge. If the two offline edits inserted different characters in the same place, both appear, in the same order on every peer. That can look interleaved. It is the correct CRDT outcome, and the UI does not pretend it was a lock-step merge.

### 10. A browser refreshes

The JavaScript context dies. Peer connections die. IndexedDB remains. On load, `y-indexeddb` applies stored updates before the editor is shown, so the text does not flash empty and then jump (the editor mounts after `whenSynced`). Signaling and WebRTC start again as in step 9. The Yjs client id changes across reloads; that is normal. Old awareness entries expire.

### Alone, offline, and “the other device is off”

If the second browser is closed, the first browser keeps editing into IndexedDB. A third browser that opens the link sees an empty note until some browser that still has the bytes is online at the same time. There is no server to catch the note up. This is the central product constraint and should be visible in the empty-room status: “Saved on this device. Others see your changes while you are both online.”

---

## 6. Project Structure

Root: `C:\Pen\collaborative-notepad`

```text
collaborative-notepad/
├── IMPLEMENTATION_PLAN.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── next-env.d.ts
├── .env.example
├── .gitignore
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                         # create a note
│   │   ├── n/[roomId]/page.tsx              # notepad route
│   │   └── api/rooms/[roomId]/
│   │       ├── presence/route.ts
│   │       ├── peers/route.ts
│   │       └── signal/route.ts
│   ├── components/
│   │   ├── NotepadShell.tsx                 # header, Share, editor slot, status
│   │   ├── StatusBar.tsx
│   │   └── Banner.tsx
│   ├── editor/
│   │   └── NotepadEditor.tsx                # CodeMirror + yCollab
│   ├── collaboration/
│   │   ├── session.ts                       # owns Y.Doc, persistence, mesh, status
│   │   ├── sync-channel.ts                  # y-protocols over one DataChannel
│   │   └── framing.ts                       # chunk / reassemble
│   ├── webrtc/
│   │   ├── mesh.ts                          # peer map, cap, reconnect
│   │   ├── negotiate.ts                     # perfect negotiation
│   │   └── ice.ts                           # STUN list, future TURN hook
│   ├── signaling/
│   │   ├── client.ts                        # browser heartbeat + poll
│   │   ├── crypto.ts                        # HKDF + AES-GCM from fragment
│   │   ├── store.ts                         # SignalingStore interface
│   │   ├── memory-store.ts                  # next dev only
│   │   └── redis-store.ts                   # production
│   ├── persistence/
│   │   └── local-doc.ts                     # IndexeddbPersistence wrapper
│   ├── hooks/
│   │   └── useSession.ts                    # useSyncExternalStore
│   ├── lib/
│   │   ├── room.ts                          # id + fragment parse/generate
│   │   └── support.ts                       # WebRTC + IndexedDB detection
│   └── types/
│       └── signaling.ts
└── tests/
    ├── room.test.ts
    ├── signaling-crypto.test.ts
    ├── yjs-converge.test.ts
    └── store.test.ts
```

Module responsibilities:

- `app/` routes render pages and validate HTTP signaling input (room id shape, body size, required fields). They do not import Yjs.
- `components/` is layout only.
- `editor/` is the only module that imports CodeMirror.
- `collaboration/session.ts` is the composition root the UI talks to.
- `sync-channel.ts` is the only module that imports `y-protocols`.
- `webrtc/` does not import Yjs. It exposes an open channel or a typed failure.
- `signaling/client.ts` runs in the browser. `store.ts` and its implementations run on the server only. The fragment key never enters the store implementations.
- `persistence/` is the only module that imports `y-indexeddb`.

This is one session class and a few focused modules, not a framework.

---

## 7. Implementation Phases

Each phase is done when its expected result is observable. Later phases do not start by rewriting earlier ones.

### Phase 1 — Project foundation

Goal: a Next.js + TypeScript app that builds and shows the notepad shell.

Tasks:

- Create the app with the App Router, TypeScript, and no example API backend beyond what Phase 5 adds.
- Add the shell: title, Share button (disabled), editor placeholder, status line.
- Add `.env.example` and `.gitignore` (ignore `.env*`, allow `.env.example`).
- Confirm `npm run build` succeeds.

Files: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/NotepadShell.tsx`.

Dependencies: none.

Expected result: the shell renders locally and as a Vercel preview, with no collaboration yet.

### Phase 2 — Room URLs

Goal: create and open secret links.

Tasks:

- Generate `roomId` and fragment key.
- Home page navigates to `/n/[roomId]#[key]`.
- Parse and validate both. Invalid id and missing fragment get explicit pages.
- Share copies the full href once the page is valid.

Files: `src/lib/room.ts`, `src/app/page.tsx`, `src/app/n/[roomId]/page.tsx`, `src/components/NotepadShell.tsx`, `tests/room.test.ts`.

Dependencies: Phase 1.

Expected result: two browsers can open the same URL shape. Nothing syncs yet. The network tab shows no fragment.

### Phase 3 — Local document

Goal: one browser can type, refresh, and see the same text, with no network.

Tasks:

- Add `yjs`, `y-indexeddb`, CodeMirror 6, and `y-codemirror.next`.
- Create `Y.Doc`, wait for `whenSynced`, mount the editor on `Y.Text("body")`.
- Add `Y.UndoManager` for local undo.
- Handle IndexedDB open failure and corrupt-load reset.
- Add a unit test that two in-memory `Y.Doc` instances converge when updates are exchanged in both orders, including a concurrent insert at the same index.

Files: `src/persistence/local-doc.ts`, `src/editor/NotepadEditor.tsx`, `src/collaboration/session.ts`, `src/hooks/useSession.ts`, `tests/yjs-converge.test.ts`.

Dependencies: Phase 2.

Expected result: typing survives refresh. The convergence test passes. No WebRTC yet.

### Phase 4 — Signaling mailbox

Goal: two browsers can exchange opaque messages through Vercel without sending note text.

Tasks:

- Define `SignalingStore`.
- Implement the memory store and the Redis store.
- Implement the three routes with validation: room id pattern, JSON shape, 32 KB body cap, mailbox length cap, TTLs.
- Prefix keys with `VERCEL_ENV`.
- Implement browser crypto for the fragment key.
- Implement the browser client: presence heartbeat, peer list, mailbox post/poll.
- Production path throws if Redis env vars are missing. Development uses memory when they are missing.
- Tests: crypto round-trip, store TTL/cap behavior against the memory store, route validation with a request-level test.

Files: `src/signaling/*`, `src/app/api/rooms/[roomId]/**`, `src/types/signaling.ts`, `tests/signaling-crypto.test.ts`, `tests/store.test.ts`, `.env.example`.

Dependencies: Phase 2. Can proceed in parallel with Phase 3 after Phase 2.

Expected result: a temporary debug action (removed at the end of Phase 6) can post a string from browser A and read it from browser B. Redis contains ciphertext. The note is still local.

### Phase 5 — WebRTC mesh

Goal: a DataChannel opens between two browsers, then among up to 8, and can send a ping.

Tasks:

- STUN configuration via `NEXT_PUBLIC_STUN_URLS` with the Cloudflare and Google defaults.
- Perfect negotiation and a single `y-sync` channel per pair.
- Trickle ICE through the mailbox.
- Peer cap of 8. The ninth peer sees a “room is full” banner and can still edit locally.
- Reconnect with backoff. Duplicate-connection suppression.
- Status mapping from ICE and channel state.
- Feature detection for missing WebRTC.

Files: `src/webrtc/*`, `src/lib/support.ts`, `src/components/StatusBar.tsx`, `src/components/Banner.tsx`.

Dependencies: Phase 4.

Expected result: on one Wi-Fi, two browsers show Connected and a ping crosses the channel. Signaling polling slows or stops after the channel opens. Note text still does not cross the channel.

### Phase 6 — Collaborative editing

Goal: the original product behavior.

Tasks:

- On channel open, run sync step 1 / step 2 and awareness exchange.
- Forward `Y.Doc` updates and awareness updates.
- Chunk large frames.
- Wire `yCollab` to the session awareness instance so remote carets render.
- Remove the Phase 4 debug sender.
- Set status copy for alone, connecting, connected, and peer count (awareness states that are still alive, including self).

Files: `src/collaboration/sync-channel.ts`, `src/collaboration/framing.ts`, `src/collaboration/session.ts`, `src/editor/NotepadEditor.tsx`.

Dependencies: Phases 3 and 5.

Expected result: the Hello / Hello World scenario works, including simultaneous typing.

### Phase 7 — Failure and recovery behavior

Goal: every failure in section 8 of the brief has a defined UI and a recovery path.

Tasks:

- Implement the status and banner matrix in section 16 below (this document’s error section).
- `online` / `offline` / `visibilitychange` / `pagehide`.
- ICE failure copy that names the missing relay without pretending TURN exists.
- Signaling HTTP failure with retry.
- IndexedDB failure banner from Phase 3, kept accurate once peers exist.
- Manual “Delete local copy”.

Files: `src/collaboration/session.ts`, `src/webrtc/mesh.ts`, `src/components/Banner.tsx`, `src/components/StatusBar.tsx`.

Dependencies: Phase 6.

Expected result: refresh, offline edit, peer drop, and forced ICE failure each produce the specified UI and recover when the network allows.

### Phase 8 — Testing

Goal: the matrix in section 11 is executed and written down, including failures.

Tasks:

- Automated tests from Phases 2–4 in CI (`npm test`).
- Two-browser manual pass on localhost.
- Deploy a preview and repeat the cross-browser matrix.
- Record NAT failures honestly. Do not “fix” them with a silent relay in this phase.

Dependencies: Phase 7.

Expected result: a short test log in the repo (`docs/test-log.md`) listing what passed, what failed, and the browser/network for each row.

### Phase 9 — Production deployment

Goal: production on Vercel with Redis required and STUN configured.

Tasks:

- Create the Vercel project, link it, set production and preview env vars.
- Provision Upstash in the same region as the Functions region (default `iad1` unless we pin another).
- Confirm production routes reject a missing Redis configuration.
- Run `npm run build` locally, then deploy.
- Smoke-test the production URL with two browsers.

Dependencies: Phase 8.

Expected result: the production URL completes the two-browser scenario on a normal home network, and the Redis console shows only short-lived signaling keys.

---

## 8. Risks and Technical Challenges

| Risk | Why it is real | What we do |
| --- | --- | --- |
| Two peers hit different Vercel instances | Documented platform behavior | Redis mailbox, never process memory, in production |
| Sockets die at 300 seconds | Documented duration cap | No session-long sockets |
| WebSocket helper is experimental and awkward in Next.js | Vercel docs | HTTP signaling |
| Direct P2P fails on some NATs | ICE / NAT, independent of our code | STUN plus an explicit failure UI; TURN is a later phase |
| All clients disappear, note is gone | No server document | Say so in the UI; do not imply cloud save |
| Offline edits interleave | CRDT behavior | Document it; do not switch to last-write-wins |
| URL room id appears in Vercel logs | Access logs include the path | Access secret lives in the fragment; encrypt signaling |
| Malicious signaling store rewrites SDP | Classic WebRTC MitM | AES-GCM with the fragment key, so altered SDP fails to decrypt |
| Someone with the link is a full editor | No accounts | Accepted for MVP; Share copy states it |
| `y-webrtc` / public signaling looks easier | Official demo path | Do not use it; it does not fit Vercel and it is the wrong maintenance surface |
| Large sync message exceeds SCTP chunk limits | MDN default 64 KB when undeclared | 16 KB framing |
| Safari tab suspension drops the channel | Mobile browser lifecycle | Reconnect on `visibilitychange` / `pageshow`; IndexedDB already has the edits |
| Safari storage eviction | ITP / site storage policy | Cannot be fully prevented; the banner already says the note lives on the devices that have it |
| IndexedDB unavailable | Private browsing | In-memory session plus a warning |
| Room id leaked and mailbox spammed | Server cannot see the fragment, so it cannot authenticate | TTL, length cap, 32 KB cap, decrypt-and-drop, Vercel rate limits. Spam cannot become document writes |
| Mesh cost grows quickly | `n(n-1)/2` connections | Hard cap of 8 (28 connections) |
| Partial mesh partitions a room | `y-webrtc` `maxConns` can form clusters | Full mesh under the cap; no partial mesh in v1 |
| Redis outage | External dependency | Existing DataChannels keep syncing; new joins show “Can’t reach the connection service” and keep local editing |
| Preview and production share Redis | Same database, different deployments | Key prefix includes `VERCEL_ENV` |
| TURN credentials leaked if placed in `NEXT_PUBLIC_*` | Anyone can read the bundle | Not in MVP; later, mint short-lived credentials on the server |
| First load of a long note feels like a full copy | State-vector sync sends everything the peer lacks, once | Correct and rare; chunk it; do not resend it per keystroke |
| Glare / duplicate peer connections | Both sides offer | Perfect negotiation plus duplicate suppression |
| Clock skew on presence TTL | Scores are server `Date.now()` | Expiry is written by the route handler, not by the client |

---

## 9. Vercel Feasibility

### What runs in the browser

The React UI, CodeMirror, `Y.Doc`, CRDT merge, undo, awareness, IndexedDB, `RTCPeerConnection`, DTLS, STUN requests, and all document bytes.

### What runs on Vercel

The Next.js build output and three signaling route handlers. Each invocation is a short function call. Fluid compute may reuse an instance; the code does not care which instance it is, because the mailbox is in Redis.

### What data Vercel sees

- HTML, JS, and CSS.
- Request paths containing `roomId`.
- `peerId` values.
- Encrypted signaling envelopes.
- Source IP and user agent in the platform logs.
- Presence timestamps.

Vercel does not see the fragment key, the note text, Yjs updates, or cursor positions, provided we do not log request bodies. The routes must not log bodies. SDP inside the ciphertext includes IP addresses; operators who lack the fragment key cannot read them.

### What is exchanged peer-to-peer

Yjs sync messages and awareness (carets, a random display color, a short anonymous label). Encrypted with DTLS. STUN sees reflexive addresses during setup. After ICE completes, media-path packets go browser to browser on the direct path.

### Is a separate backend required?

No separate server is required. Signaling routes inside this Next.js app are required. A purely static Vercel deployment cannot do peer discovery. `output: 'export'` is incompatible with the architecture.

### Is Redis required?

Yes, for any deployment that runs more than one Function instance, which is the production platform. It is signaling state with TTLs, not a document database. Local development may use the in-memory store.

### Is STUN required?

Yes. Without STUN, peers on different networks often have only host candidates and fail to connect. The MVP uses public STUN.

### Is TURN required?

Not for the MVP, and not optional to *think* about. Same-network and many home-network tests will pass without it. Some real networks will fail until a relay exists. The MVP ships the failure. Production connectivity should add short-lived TURN credentials.

### Limitations of doing this on Vercel

- WebSockets are beta, capped by function duration, and still need Redis. They are not used.
- There is no durable document. Vercel cannot restore a note.
- There is no sticky room instance to cheat with.
- Function logs will retain room ids.
- A signaling route is a small backend in the only sense that matters: it is server code. It is not a document backend, and it is not a second piece of infrastructure to operate.

### Environment variables

```text
UPSTASH_REDIS_REST_URL=          # server only, required in production
UPSTASH_REDIS_REST_TOKEN=        # server only, required in production
NEXT_PUBLIC_STUN_URLS=stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302
```

No document secrets, no TURN secrets, no fragment keys in the environment.

### Local, preview, production

- Local: `npm install`, `npm run dev`. Memory signaling store if Redis is unset. WebRTC works on `localhost` because it is a secure context.
- Preview: Vercel preview deployment, Redis required, key prefix `preview`.
- Production: `npm run build` then Vercel production, Redis required, key prefix `production`.
- `vercel.json` is unnecessary for MVP. Do not add rewrites that would cache signaling GET responses. Those routes send `Cache-Control: no-store`.

---

## 10. Security Model

### What WebRTC encrypts

DataChannels run SCTP over DTLS (RFC 8831). DTLS provides confidentiality, integrity, and authentication of the DTLS peer certificate. Browsers require this. The note on the wire is not plaintext. A TURN relay, if added later, forwards those DTLS packets and does not receive the note as text. Cloudflare’s TURN documentation says the same thing about their relay.

The certificate is self-signed and the fingerprint is carried in SDP. Encryption between the two browsers is only as trustworthy as the signaling path that delivered the fingerprints. Encrypting signaling bodies with the fragment key means a modified offer or candidate fails decryption, which blocks a signaling-level man-in-the-middle from substituting a fingerprint. This is the same goal as `y-webrtc`’s optional room password, implemented on our mailbox.

### What WebRTC does not protect

- It does not authenticate people. Anyone who has the full URL is a peer and can read and edit everything.
- It does not hide IP addresses from the other peer. ICE candidates contain them, and once decrypted on the peer they are visible to that peer’s browser.
- It does not hide IP addresses from STUN servers. STUN exists to learn the public address.
- It does not protect the note from the other participant, from browser extensions, or from someone with access to the device’s profile.
- It does not provide forward secrecy beyond what the DTLS session provides, and it does not provide a server-side audit log. There is nothing to audit on the server except signaling metadata.
- It does not stop a participant from pasting the note somewhere else.

### Room ids and shared links

The fragment is the capability. The room id is an identifier and will show up in logs. A log line alone must not be enough to join. The client refuses to sync without the fragment.

Guessing a 128-bit key is not a relevant attack. Leaking the full URL is total compromise of that note, including future edits, until everyone abandons the id. There is no revocation in MVP. “Delete local copy” is local only.

### Signaling

Messages carry `to`, `from`, a message id, and ciphertext. They do not carry note text, the fragment, or awareness. Routes do not log bodies. Redis expiry is short so SDP does not sit around.

### STUN

STUN learns and discloses public IP and port to the peer as a candidate. That is required for NAT traversal. The STUN host is a public anycast service. It does not see the note.

### TURN (later)

A relay sees who is talking to it, when, and how much ciphertext flows. It does not see the note. Using TURN means the bytes are no longer on a direct path. Credentials must be short-lived and minted by a route handler.

### Browser storage

IndexedDB holds the note in the origin’s storage for this browser profile. Same-origin script can read it. Another site cannot. Clearing site data deletes the local copy. Other peers keep theirs.

### What we do not collect

No account, no email, no analytics in MVP, no document backup, no recording of note contents in logs.

---

## 11. Testing Plan

Automated, on every implementation phase that introduces them:

- Room id and fragment parser: valid, missing hash, wrong length, padding, extra query string.
- AES-GCM: encrypt, decrypt, reject a flipped byte, reject a wrong key.
- Memory store: presence expiry, mailbox cap, addressed delivery (A does not read B’s mailbox).
- Yjs: sequential exchange, reversed delivery, duplicate delivery, concurrent insert at the same index, offline insert on both sides then exchange. Assert identical `Y.Text.toString()`.

Manual functional matrix. Two browsers unless noted.

| Case | Pass condition |
| --- | --- |
| A creates a note | URL has a room id and a fragment; editor is empty; status is local |
| A refreshes immediately | Editor still empty; no error |
| A types, refreshes | Text restored before the editor is interactive |
| A copies the link, B opens it | B reaches Connected; B receives existing text without A retyping |
| A types `Hello` | B shows `Hello` |
| B types `Hello World` | A shows `Hello World` |
| Both type in the same region | Both end on the same string; neither cursor jumps to the end |
| A closes the tab | B’s count returns to 1; B’s text remains |
| A reopens the link | Text merges; no duplicate paragraph from the replay |
| A goes offline in DevTools, types, comes online | B receives the offline edits; A receives anything B typed |
| B joins while A is offline and has never met A | B sees an empty note and the “saved on this device” status, not an error |
| Malformed room id | Invalid-link page |
| Room id with the fragment stripped | Full-link-required page |
| Ninth browser | Local editing works; banner says the room is full; no ninth DataChannel |

WebRTC matrix:

| Network | Browsers | Pass condition |
| --- | --- | --- |
| Same Wi-Fi | Chrome + Chrome | Connected, sync works |
| Same Wi-Fi | Chrome + Firefox | Connected, sync works |
| Same Wi-Fi | Chrome + Safari | Connected, or a specific Safari bug written in the test log |
| Phone hotspot + laptop broadband | Chrome + Chrome | Connected, or ICE-failure banner if the NAT path blocks UDP |
| Laptop + phone on the same Wi-Fi | Desktop Chrome + mobile Safari | Sync works and the phone can type |
| Tab refresh during typing | Either | Text preserved; channel returns |
| Browser quit and reopen | Either | Text preserved from IndexedDB; sync resumes if the other peer is up |

Browser matrix: desktop Chrome, Edge, Firefox, Safari; mobile Chrome; mobile Safari. Internet Explorer is unsupported by feature detection.

Persistence matrix: refresh, browser restart, offline edit, reconnect, delete local copy (this browser empties; the peer keeps the note), IndexedDB disabled (banner, in-memory editing).

Deployment matrix: `next dev` with the memory store; Vercel preview with Redis and two browsers that are not on the same machine as the dev server; production smoke test after Phase 9.

A failure that is “ICE failed, banner shown, local text safe” is a passed test of the failure path. A failure that is a hung “Connecting…” is a defect.

---

## 12. MVP Scope

### Version 1 includes

- Create note, secret URL, Share.
- Plain-text CodeMirror editor bound to `Y.Text`.
- Real-time sync over a WebRTC DataChannel using Yjs sync messages.
- Simultaneous editing and per-user undo.
- Remote carets and a live peer count.
- IndexedDB persistence, offline edits, reconnect, refresh.
- Full mesh, maximum 8 peers.
- STUN, perfect negotiation, reconnect backoff.
- Encrypted signaling mailbox on Vercel + Redis.
- The failure banners in this plan.
- Feature detection for WebRTC and IndexedDB.

### Postponed

- TURN and the credential-minting route.
- WebSocket signaling.
- Accounts, read-only links, revocation, expiry of a note.
- Rich text, titles, folders, comments, version history.
- A server archive of the document. Adding one later means introducing a database on purpose, which changes the product.
- Partial-mesh routing for rooms larger than 8.
- BroadcastChannel optimization for two tabs in the same browser. WebRTC between those tabs is acceptable for v1.
- Service worker / installable PWA.
- Analytics, rate-limit dashboards, and automated cross-browser CI farms. Manual matrix first. Playwright with two browser contexts on localhost is a reasonable follow-up for the same-machine path, not a substitute for the NAT matrix.

### Product limitations that version 1 must state in the UI

- The note is stored on the devices that have opened it.
- Other people see edits while you are connected to each other.
- If every device loses the local copy, the note is gone.
- Anyone with the full link can edit.

---

## 13. Step-by-Step Implementation Order

1. Approve this plan, including Redis as signaling-only state and STUN-only connectivity for v1.
2. Scaffold Next.js + TypeScript in `C:\Pen\collaborative-notepad` and render the shell.
3. Implement room id and fragment generation, validation, and Share.
4. Add `Y.Doc`, `y-indexeddb`, and CodeMirror; editing survives refresh.
5. Add the in-memory convergence unit test and keep it green from here on.
6. Add the signaling store interface, memory implementation, and routes.
7. Add fragment encryption and the browser signaling client. Prove with a throwaway ping that two browsers exchange ciphertext.
8. Add the Redis store and `.env.example`. Gate production on the Redis env vars.
9. Add `RTCPeerConnection`, perfect negotiation, STUN, and a DataChannel ping across two browsers.
10. Add the 8-peer cap and duplicate-connection handling.
11. Replace the ping with `y-protocols` sync and awareness. Remove the debug ping.
12. Bind remote carets and the status line to session state.
13. Add reconnect, offline, visibility, and ICE-failure behavior.
14. Run the automated tests and the manual matrix. Write `docs/test-log.md`.
15. Provision Upstash, set Vercel env vars, deploy a preview, repeat the two-browser test on the preview URL.
16. Promote to production and run the smoke test.

Do not insert a document database, `y-webrtc`, `y-websocket`, Socket.IO, or a second host during these steps.

---

## 14. Final Recommendation

Build one Next.js application and deploy it to Vercel.

The note lives in a Yjs document in each browser, persisted with `y-indexeddb`, edited with CodeMirror 6. While peers are connected, updates move over a WebRTC DataChannel and merge because Yjs updates are commutative, associative, and idempotent. That is the real-time collaborative notepad, and it does not need a document server.

Vercel’s job is the UI plus a small encrypted mailbox so browsers can exchange SDP and ICE and discover peer ids. Current Vercel documentation says that mailbox cannot live in Function memory and that WebSockets are a beta, duration-capped, instance-pinned channel. Redis is the minimum shared state that makes the mailbox true on the real platform. It stores no note content. STUN is required so different networks have a chance to connect. TURN is the production fix for networks where they cannot, and version 1 will say so when ICE fails instead of quietly relaying.

This meets the original goal: the app deploys on Vercel, there is no traditional document backend and no document database, and the browsers synchronize the note peer-to-peer whenever a direct DataChannel exists.

Implementation should wait for approval of three decisions:

1. HTTP signaling plus Upstash Redis, instead of in-memory Vercel WebSockets.
2. A hand-rolled DataChannel provider on `y-protocols`, instead of the `y-webrtc` package.
3. STUN-only MVP, with an explicit ICE-failure state, and TURN deferred.

---

## Appendix A — Error behavior

| Condition | UI | Recovery |
| --- | --- | --- |
| WebRTC API missing | Banner: this browser can’t join live editing. Editor stays local if IndexedDB works | None, other than a different browser |
| Signaling HTTP 5xx or network error while joining | Status: reconnecting to the connection service. Local editing continues | Retry with the same backoff as peer reconnect |
| Redis unset in production | Route returns 503. Banner as above | Configuration fix, not a user action |
| ICE `failed` or timed out | Banner: couldn’t open a direct connection on this network. Changes stay on this device | Automatic retry with backoff. Manual retry button |
| Peer DataChannel closes | Count decreases. Status returns to local if nobody else remains | Automatic re-handshake when the peer heartbeats again |
| Duplicate connection | No UI. Extra connection is closed | — |
| Invalid room id | Full-page message, no editor | Ask for a corrected link |
| Missing fragment | Full-page message, no editor | Open the full shared link |
| IndexedDB unavailable | Banner: this note will disappear if you refresh | Session continues in memory |
| Local data fails to load | Banner: the copy on this device was reset | Empty document; peers may fill it in |
| Room already has 8 peers | Banner: room is full. You can type locally; live sync stays off | Retry if someone leaves |
| `navigator.onLine === false` | Status: offline. Saved on this device | `online` event starts signaling again |
| Tab suspended on mobile | No extra banner if the channel returns quickly | `visibilitychange` / `pageshow` reconnect |
| Network switch (Wi-Fi to cellular) | Brief “reconnecting” | New ICE handshake; Yjs delta sync |
| Signaling decrypt failure | Envelope dropped, no banner for a single bad message | A sustained failure to connect surfaces as the ICE or signaling banner |

## Appendix B — Performance notes

- Do not debounce keystrokes on the network. A character is one small Yjs update, usually well under 1 KB, and the DataChannel is the right place to send it immediately. Debouncing would add latency without fixing a measured problem.
- CodeMirror already batches input into transactions. One transaction produces one Yjs update. That is the right granularity.
- `y-indexeddb` writes each update as it happens and compacts the log after 500 updates, debounced by 1 second inside the provider. Do not add a second persistence delay in front of it.
- Initial sync of a note the peer lacks can be large. It happens once per pair, is chunked at 16 KB, and is not repeated on each keystroke.
- Memory is one `Y.Doc` plus CodeMirror’s document plus the open peer connections. A notepad-sized text is not a memory problem. Notes beyond roughly a megabyte of text are outside the tested envelope; we do not build a special pager for them in v1.
- At 8 peers, one keystroke is sent 7 times. The payload is tiny. The cap exists to bound connection setup and reconnect complexity, not because the text fan-out is expensive.
- Reconnect cost is one new handshake plus a state-vector round trip, not a server replay of history.

## Appendix C — Assumptions

- The approver accepts Upstash Redis (or an equivalent Redis with an HTTP API) as signaling infrastructure.
- The approver accepts that version 1 fails closed on networks that need TURN.
- Users have current Chrome, Edge, Firefox, or Safari.
- The deployment is a single Vercel project in one Function region.
- Anonymous edit-anyone-with-the-link is the security model.
- Eventual CRDT merge is the conflict model, including interleaved offline inserts.
- No compliance regime requires a server-side copy or audit trail. If one appears later, the architecture has to change on purpose.
