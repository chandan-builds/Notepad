# Notepad

A plain-text note shared by secret link. The text stays in each browser, syncs over a WebRTC data channel while peers are online, and is rendezvoused by short signaling requests. There is no document database.

## Run locally

```bash
npm install
npm run dev
```

With Redis unset, `next dev` keeps the signaling mailbox in memory. Open the app, start a note, and paste the full URL (including the `#` secret) into a second browser profile or another browser on the same machine.

```bash
npm test
npm run build
```

## Production

Set these on the Vercel project. Preview and production refuse to signal if Redis is missing.

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
NEXT_PUBLIC_STUN_URLS=stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302
```

Redis stores peer ids and encrypted SDP/ICE envelopes with short TTLs. It does not store the note or the URL fragment.

Version 1 uses STUN only. If a network cannot open a direct peer connection, the note stays on the device and the page says so.
